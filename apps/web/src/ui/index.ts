/**
 * The one Loose Pixels UI kit (art bible §6–7), used by the shell and every page. The stylesheet is imported here; the
 * shell wraps the app in `pl-root`. Every component is keyboard + touch accessible and honours reduced motion.
 */
import "./ui.css";

export { Button, ButtonLink, LinkButton, type ButtonLook, type ButtonVariant } from "./Button.js";
export { Card, type CardProps } from "./Card.js";
export { cx } from "./cx.js";
export { formatAgo, formatBps, formatClock, formatDuration, formatInt, formatRf, shortHash } from "./format.js";
export {
  describePortrait,
  FriendPortrait,
  type FriendPortraitProps,
  type PortraitSelection,
} from "./FriendPortrait.js";
export { useNow, useReducedMotion } from "./hooks.js";
export { Modal, type ModalProps, Sheet } from "./Modal.js";
export { Badge, Pill, SimulatedBadge, type Tone } from "./Pill.js";
export { COUNT_STEPS, PixelNumber, type PixelNumberProps } from "./PixelNumber.js";
export {
  type CellState,
  type Paint2D,
  paintPortrait,
  portraitGeometry,
  portraitLayers,
  type PortraitGeometry,
  type PortraitLayers,
} from "./portrait.js";
export { ProgressBlocks, type ProgressBlocksProps } from "./ProgressBlocks.js";
export { SplitBar, type SplitPart } from "./SplitBar.js";
export {
  EmptyState,
  ErrorState,
  Loading,
  LoadingBlock,
  type Remote,
  remote,
  RemoteView,
  Skeleton,
  Stat,
} from "./States.js";
export { Tabs, type TabItem, type TabsProps } from "./Tabs.js";
export { ToastRegion, type ToastItem, useToasts } from "./Toast.js";
export { COLORS, nextStreakTier, streakTier, type StreakTier } from "./tokens.js";
