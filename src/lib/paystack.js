// Paystack Inline script loader — lazily injects the Paystack
// checkout script once and caches the promise.
let paystackScriptPromise = null;

function loadPaystackScript() {
  if (window.PaystackPop) return Promise.resolve(window.PaystackPop);

  if (!paystackScriptPromise) {
    paystackScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
          script.src = 'https://js.paystack.co/v2/inline.js';
      script.async = true;
      script.onload = () => resolve(window.PaystackPop);
      script.onerror = () => reject(new Error('Failed to load Paystack. Please check your connection.'));
      document.body.appendChild(script);
    });
  }

  return paystackScriptPromise;
}

export async function getPaystackPop() {
  return loadPaystackScript();
}
