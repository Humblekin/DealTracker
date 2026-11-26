import './DealGuiderMascot.css';

import successSvg from '../assets/mascot/mascot-success.svg';
import paymentFailedSvg from '../assets/mascot/mascot-payment-failed.svg';
import cancelledSvg from '../assets/mascot/mascot-cancelled.svg';
import disputedSvg from '../assets/mascot/mascot-disputed.svg';
import processingSvg from '../assets/mascot/mascot-processing.svg';
import emptyDashboardSvg from '../assets/mascot/mascot-empty-dashboard.svg';
import emptyTransactionsSvg from '../assets/mascot/mascot-empty-transactions.svg';
import invalidDealSvg from '../assets/mascot/mascot-invalid-deal.svg';
import refundedSvg from '../assets/mascot/mascot-refunded.svg';

const MASCOT_VARIANTS = {
  'success': {
    src: successSvg,
    defaultAlt: 'Kofi celebrating successful deal completion with a golden trophy',
    animationClass: 'mascot-anim-celebrate',
  },
  'payment-failed': {
    src: paymentFailedSvg,
    defaultAlt: 'Kofi holding a payment receipt indicating an issue with payment',
    animationClass: 'mascot-anim-wobble',
  },
  'cancelled': {
    src: cancelledSvg,
    defaultAlt: 'Kofi with cancelled deal documentation',
    animationClass: 'mascot-anim-fade',
  },
  'disputed': {
    src: disputedSvg,
    defaultAlt: 'Kofi carefully inspecting dispute records with a magnifying glass',
    animationClass: 'mascot-anim-pulse',
  },
  'processing': {
    src: processingSvg,
    defaultAlt: 'Kofi protecting funds in secure escrow with a shield',
    animationClass: 'mascot-anim-float',
  },
  'empty-dashboard': {
    src: emptyDashboardSvg,
    defaultAlt: 'Kofi warmly waving to welcome you to DealGuider',
    animationClass: 'mascot-anim-wave',
  },
  'empty-transactions': {
    src: emptyTransactionsSvg,
    defaultAlt: 'Kofi holding a clipboard awaiting transaction records',
    animationClass: 'mascot-anim-float',
  },
  'invalid-deal': {
    src: invalidDealSvg,
    defaultAlt: 'Kofi looking puzzled as the requested deal link cannot be found',
    animationClass: 'mascot-anim-shake',
  },
  'refunded': {
    src: refundedSvg,
    defaultAlt: 'Kofi holding refund confirmation and returned funds',
    animationClass: 'mascot-anim-fade',
  },
};

const SIZE_MAP = {
  xs: 64,
  sm: 104,
  md: 156,
  lg: 208,
  xl: 256,
};

export default function DealGuiderMascot({
  variant = 'processing',
  size = 'md',
  alt,
  className = '',
  animate = true,
  style = {},
  ...rest
}) {
  const config = MASCOT_VARIANTS[variant] || MASCOT_VARIANTS['processing'];
  const resolvedAlt = alt !== undefined ? alt : config.defaultAlt;

  const isNumericSize = typeof size === 'number';
  const dimension = isNumericSize ? size : SIZE_MAP[size] || SIZE_MAP.md;
  const sizeClass = typeof size === 'string' && SIZE_MAP[size] ? `mascot-size-${size}` : '';
  const animClass = animate ? config.animationClass : '';
  const wrapperStyle = isNumericSize
    ? { width: dimension, height: dimension, ...style }
    : style;

  return (
    <div
      className={`dealguider-mascot-wrapper ${sizeClass} ${animClass} ${className}`.trim()}
      style={wrapperStyle}
      {...rest}
    >
      <img
        src={config.src}
        alt={resolvedAlt}
        className="dealguider-mascot-img"
        loading="lazy"
        draggable="false"
        width={dimension}
        height={dimension}
      />
    </div>
  );
}

export { MASCOT_VARIANTS };

