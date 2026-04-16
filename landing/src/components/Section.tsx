import type { ReactNode } from 'react'

interface SectionProps {
  readonly id?: string
  readonly children: ReactNode
  readonly className?: string
}

export function Section({ id, children, className = '' }: SectionProps) {
  return (
    <section
      id={id}
      className={`px-6 py-16 md:px-8 md:py-24 ${className}`}
    >
      <div className="mx-auto max-w-4xl">{children}</div>
    </section>
  )
}

interface SectionTitleProps {
  readonly children: ReactNode
  readonly subtitle?: string
}

export function SectionTitle({ children, subtitle }: SectionTitleProps) {
  return (
    <div className="mb-12">
      <h2 className="mb-3 font-[Bricolage_Grotesque] text-2xl font-bold tracking-tight md:text-3xl" style={{ color: 'oklch(0.22 0.01 85)' }}>
        {children}
      </h2>
      {subtitle && (
        <p className="max-w-2xl text-base leading-relaxed" style={{ color: 'oklch(0.45 0.01 85)' }}>
          {subtitle}
        </p>
      )}
    </div>
  )
}
