import { useId, type ComponentProps } from 'react'

type ComposerToolButtonProps = ComponentProps<'button'> & {
  label: string
  hint?: string
}

/** 图标保持紧凑，功能和状态在悬停或键盘聚焦时显示。 */
export function ComposerToolButton({ label, hint, className = '', children, ...props }: ComposerToolButtonProps) {
  const tooltipId = useId()
  return <span className="composer-tool">
    <button type="button" {...props} className={`composer-icon-button ${className}`.trim()} aria-label={label} aria-describedby={tooltipId}>
      {children}
    </button>
    <span id={tooltipId} className="composer-tooltip" role="tooltip">{label}{hint && <span>{hint}</span>}</span>
  </span>
}
