// ---------------------------------------------------------------
// Confirm Delivery — Hardened Payout with Atomic Concurrency Control
//
// Key Protections:
//   1. Atomic Payout Reservation: Stored procedure `reserve_payout`
//      uses SELECT ... FOR UPDATE to ensure only ONE concurrent request
//      can claim the payout, eliminating the race condition.
//   2. Durable State Machine: Tracks payout_status:
//      RESERVED → PROCESSING → SUCCESS / FAILED / PENDING_VERIFICATION.
//   3. Persistent Payout Reference: Persisted in the database BEFORE
//      initiating the HTTP call to Paystack.
//   4. Reconciliation on Retry: Queries Paystack verify endpoint before
//      any re-attempt to prevent duplicate transfers if a previous
//      request succeeded but the DB update failed.
//   5. Network Failure Safety: If the Paystack HTTP call times out or
//      fails unexpectedly, marks PENDING_VERIFICATION instead of blindly
//      retrying or assuming non-execution.
//   6. Status Integrity: A deal is only marked COMPLETED when Paystack
//      confirms transfer success (or when transfer.success webhook arrives).
// ---------------------------------------------------------------
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.106.2'
import { corsHeaders, handleCors, methodNotAllowed } from '../_shared/cors.ts'
import { createTransferRecipient, initiateTransfer, verifyTransfer } from '../_shared/paystack.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

serve(async (req) => {
  const origin = req.headers.get('Origin')
  const cors = corsHeaders(origin)

  const corsRes = handleCors(req)
  if (corsRes) return corsRes

  if (req.method !== 'POST') return methodNotAllowed(req)

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: cors })
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    )
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: cors })
    }

    const { deal_id } = await req.json()
    if (!deal_id) {
      return new Response(JSON.stringify({ error: 'deal_id is required' }), { status: 400, headers: cors })
    }

    // Fetch deal with seller profile
    const { data: deal, error: dealError } = await supabase
      .from('deals')
      .select('*, seller:profiles!seller_id(*)')
      .eq('id', deal_id)
      .single()

    if (dealError || !deal) {
      return new Response(JSON.stringify({ error: 'Deal not found' }), { status: 404, headers: cors })
    }

    if (deal.buyer_id !== user.id) {
      return new Response(JSON.stringify({ error: 'Only the buyer can confirm delivery' }), { status: 403, headers: cors })
    }

    // Check if payout is already completed
    if (deal.status === 'COMPLETED' || deal.payout_status === 'SUCCESS') {
      return new Response(JSON.stringify({
        success: true,
        message: 'This deal has already been completed and payout sent.',
      }), { status: 200, headers: cors })
    }

    // Check if an active payout reservation / processing is already running
    if (deal.payout_status === 'RESERVED' || deal.payout_status === 'PROCESSING') {
      return new Response(JSON.stringify({
        error: 'Payout is currently being processed. Please check back in a moment.',
      }), { status: 409, headers: cors })
    }

    // -----------------------------------------------------------------
    // Step 1: Reconciliation check — if a previous payout reference exists,
    // verify with Paystack first before taking any new action.
    // -----------------------------------------------------------------
    if (deal.payout_reference) {
      try {
        const verification = await verifyTransfer(deal.payout_reference)
        if (verification.success && verification.status === 'success') {
          // Paystack succeeded earlier! Reconcile the database.
          await supabase.rpc('finalize_payout', {
            p_deal_id: deal_id,
            p_new_payout_status: 'SUCCESS',
            p_new_deal_status: 'COMPLETED',
          })

          await supabase.from('audit_logs').insert({
            deal_id,
            action: 'PAYOUT_RECONCILED_SUCCESS',
            actor_id: user.id,
            details: {
              reference: deal.payout_reference,
              note: 'Recovered successful Paystack transfer during reconciliation',
            },
          })

          await supabase.from('notifications').insert([
            {
              user_id: deal.seller_id,
              title: 'Payment Received',
              message: `Your payout of GH₵ ${parseFloat(deal.net_amount || deal.amount).toFixed(2)} for "${deal.title}" has been verified and delivered.`,
              type: 'payment',
              deal_id,
            },
            {
              user_id: deal.buyer_id,
              title: 'Deal Completed',
              message: `The deal "${deal.title}" delivery is confirmed and payment verified with Paystack.`,
              type: 'info',
              deal_id,
            },
          ])

          return new Response(JSON.stringify({
            success: true,
            message: 'Delivery confirmed! Payout was already processed and verified with Paystack.',
          }), { status: 200, headers: cors })
        } else if (verification.status === 'pending' || verification.status === 'processing') {
          // Transfer is still in flight at Paystack — do not re-initiate
          await supabase.from('deals').update({ payout_status: 'PROCESSING' }).eq('id', deal_id)
          return new Response(JSON.stringify({
            success: true,
            message: 'Payout is currently being processed by Paystack. Please check back shortly.',
          }), { status: 200, headers: cors })
        } else if (verification.status === 'failed' || verification.status === 'reversed') {
          // Paystack confirmed the previous transfer failed.
          // Safely set payout_status to FAILED so reserve_payout allows a fresh reservation
          await supabase.rpc('finalize_payout', {
            p_deal_id: deal_id,
            p_new_payout_status: 'FAILED',
            p_new_deal_status: 'DELIVERED',
          })
          await supabase.from('audit_logs').insert({
            deal_id,
            action: 'PAYOUT_PREVIOUS_FAILED_VERIFIED',
            actor_id: user.id,
            details: { reference: deal.payout_reference, verification_status: verification.status },
          })
        }
      } catch (verifyErr) {
        console.warn(`[confirm-delivery] verifyTransfer error for ref ${deal.payout_reference}:`, verifyErr)
        // Ambiguous state protection: if deal is PENDING_VERIFICATION and verifyTransfer failed,
        // do NOT allow a new transfer to be initiated!
        if (deal.payout_status === 'PENDING_VERIFICATION') {
          return new Response(JSON.stringify({
            error: 'Transfer verification with payment provider timed out. Cannot retry until transfer status is confirmed.',
            pending_verification: true,
          }), { status: 409, headers: cors })
        }
      }
    }

    // Validate seller payout details
    if (!deal.seller?.phone || !deal.seller?.network) {
      return new Response(JSON.stringify({
        error: 'Seller has not configured payout details (phone and network). Please contact support.',
      }), { status: 400, headers: cors })
    }

    const payoutAmount = parseFloat(deal.net_amount || deal.amount)

    // -----------------------------------------------------------------
    // Step 2: Ensure seller has a cached Paystack transfer recipient code
    // -----------------------------------------------------------------
    let recipientCode = deal.seller?.recipient_code || null
    if (!recipientCode) {
      const recipient = await createTransferRecipient({
        name: deal.seller.full_name || `Seller ${deal.seller_id}`,
        phone: deal.seller.phone,
        network: deal.seller.network,
      })

      if (!recipient.success || !recipient.recipient_code) {
        await supabase.from('audit_logs').insert({
          deal_id,
          action: 'PAYOUT_FAILED',
          actor_id: user.id,
          details: { error: recipient.error, stage: 'recipient' },
        })

        const { data: admins } = await supabase.from('profiles').select('id').eq('role', 'admin')
        const adminNotifs = (admins || []).map(a => ({
          user_id: a.id,
          title: 'Payout Recipient Creation Failed',
          message: `Auto-payout recipient creation failed for deal #${deal_id} (GH₵ ${payoutAmount.toFixed(2)}). Manual intervention required.`,
          type: 'payment',
          deal_id,
        }))
        if (adminNotifs.length > 0) {
          await supabase.from('notifications').insert(adminNotifs)
        }

        return new Response(JSON.stringify({
          success: true,
          awaiting_admin: true,
          message: 'Delivery confirmed! Payout recipient setup requires admin review.',
        }), { status: 200, headers: cors })
      }

      recipientCode = recipient.recipient_code
      await supabase.from('profiles').update({ recipient_code: recipientCode }).eq('id', deal.seller_id)
    }

    // -----------------------------------------------------------------
    // Step 3: Atomic Payout Reservation
    // Call stored procedure `reserve_payout` with exclusive row lock.
    // -----------------------------------------------------------------
    const payoutRef = `ST-PO-${deal_id}-${Date.now()}`

    const { data: reserveResult, error: reserveError } = await supabase.rpc('reserve_payout', {
      p_deal_id: deal_id,
      p_payout_reference: payoutRef,
    })

    if (reserveError) throw reserveError

    if (!reserveResult?.success) {
      if (reserveResult?.code === 'ALREADY_COMPLETED') {
        return new Response(JSON.stringify({
          success: true,
          message: 'Payout was already processed for this deal.',
        }), { status: 200, headers: cors })
      }
      if (reserveResult?.code === 'ALREADY_PROCESSING') {
        return new Response(JSON.stringify({
          error: 'Payout is currently being processed by another request. Please wait a moment.',
        }), { status: 409, headers: cors })
      }
      if (reserveResult?.code === 'PENDING_VERIFICATION') {
        return new Response(JSON.stringify({
          error: 'A previous transfer attempt is pending verification with the payment provider. Cannot retry until transfer status is confirmed.',
          pending_verification: true,
        }), { status: 409, headers: cors })
      }
      return new Response(JSON.stringify({
        error: reserveResult?.error || 'Unable to reserve payout',
      }), { status: 400, headers: cors })
    }

    await supabase.from('audit_logs').insert({
      deal_id,
      action: 'DELIVERY_CONFIRMED',
      actor_id: user.id,
      details: { amount: deal.amount, payout_amount: payoutAmount, payout_reference: payoutRef },
    })

    console.log(`[confirm-delivery] deal ${deal_id}: Reserved payout with reference ${payoutRef}`)

    // -----------------------------------------------------------------
    // Step 4: Initiate Transfer with Paystack
    // Payout reference was already persisted in Step 3.
    // -----------------------------------------------------------------
    let transfer
    try {
      transfer = await initiateTransfer({
        amount: payoutAmount,
        recipientCode,
        reason: `DealGuider payout for "${deal.title}"`,
        reference: payoutRef,
      })
    } catch (networkErr) {
      // Ambiguous outcome: Network/timeout error. Do NOT assume non-execution.
      console.error(`[confirm-delivery] deal ${deal_id}: Network/timeout during transfer initiation:`, networkErr)

      await supabase.rpc('finalize_payout', {
        p_deal_id: deal_id,
        p_new_payout_status: 'PENDING_VERIFICATION',
        p_new_deal_status: 'DELIVERED',
      })

      await supabase.from('audit_logs').insert({
        deal_id,
        action: 'PAYOUT_TIMEOUT_PENDING_VERIFICATION',
        actor_id: user.id,
        details: {
          reference: payoutRef,
          error: networkErr instanceof Error ? networkErr.message : 'Network error/timeout',
        },
      })

      return new Response(JSON.stringify({
        success: true,
        pending_verification: true,
        message: 'Delivery confirmed! Payout transfer is pending verification with the payment provider.',
      }), { status: 200, headers: cors })
    }

    // Handle Paystack definitive failure
    if (!transfer.success) {
      console.log(`[confirm-delivery] deal ${deal_id}: Transfer failed from Paystack: ${transfer.error}`)

      await supabase.rpc('finalize_payout', {
        p_deal_id: deal_id,
        p_new_payout_status: 'FAILED',
        p_new_deal_status: 'DELIVERED',
      })

      await supabase.from('audit_logs').insert({
        deal_id,
        action: 'PAYOUT_FAILED',
        actor_id: user.id,
        details: { error: transfer.error, reference: payoutRef },
      })

      const { data: admins } = await supabase.from('profiles').select('id').eq('role', 'admin')
      const adminNotifs = (admins || []).map(a => ({
        user_id: a.id,
        title: 'Payout Failed',
        message: `Auto-payout failed for deal #${deal_id} (GH₵ ${payoutAmount.toFixed(2)}): ${transfer.error}. Manual intervention required.`,
        type: 'payment',
        deal_id,
      }))
      if (adminNotifs.length > 0) {
        await supabase.from('notifications').insert(adminNotifs)
      }

      return new Response(JSON.stringify({
        success: true,
        awaiting_admin: true,
        message: 'Delivery confirmed! Transfer could not be completed automatically and has been flagged for admin review.',
      }), { status: 200, headers: cors })
    }

    // -----------------------------------------------------------------
    // Step 5: Handle successful Paystack initiation
    // If status is 'success': Mark COMPLETED and SUCCESS.
    // If status is 'pending' / 'processing': Keep DELIVERED and mark PROCESSING.
    // -----------------------------------------------------------------
    const isDirectSuccess = transfer.status === 'success'
    const newPayoutStatus = isDirectSuccess ? 'SUCCESS' : 'PROCESSING'
    const newDealStatus = isDirectSuccess ? 'COMPLETED' : 'DELIVERED'

    await supabase.rpc('finalize_payout', {
      p_deal_id: deal_id,
      p_new_payout_status: newPayoutStatus,
      p_new_deal_status: newDealStatus,
    })

    await supabase.from('audit_logs').insert({
      deal_id,
      action: 'FUNDS_TRANSFERRED',
      actor_id: user.id,
      details: {
        reference: transfer.reference || payoutRef,
        transfer_code: transfer.transfer_code,
        transfer_status: transfer.status || 'unknown',
        amount: payoutAmount,
        recipient_code: recipientCode,
      },
    })

    await supabase.from('notifications').insert([
      {
        user_id: deal.seller_id,
        title: isDirectSuccess ? 'Payment Received' : 'Payout Processing',
        message: isDirectSuccess
          ? `Your payout of GH₵ ${payoutAmount.toFixed(2)} for "${deal.title}" has been sent to your mobile wallet.`
          : `Your payout for "${deal.title}" has been initiated and is being processed by Paystack.`,
        type: 'payment',
        deal_id,
      },
      {
        user_id: deal.buyer_id,
        title: 'Deal Completed',
        message: `The deal "${deal.title}" delivery is confirmed. Thank you for using DealGuider!`,
        type: 'info',
        deal_id,
      },
    ])

    return new Response(JSON.stringify({
      success: true,
      message: isDirectSuccess
        ? 'Delivery confirmed! Payment has been sent to the seller.'
        : 'Delivery confirmed! Payout has been initiated and is being processed by Paystack.',
      reference: transfer.reference || payoutRef,
    }), { status: 200, headers: cors })

  } catch (err) {
    console.error('[confirm-delivery] Unhandled error:', err)
    return new Response(JSON.stringify({
      error: err instanceof Error ? err.message : 'Internal server error',
    }), { status: 500, headers: cors })
  }
})
