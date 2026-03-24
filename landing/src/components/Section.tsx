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
      className={`px-6 py-20 md:px-12 lg:px-24 ${className}`}
    >
      <div className="mx-auto max-w-5xl">{children}</div>
    </section>
  )
}

interface SectionTitleProps {
  readonly children: ReactNode
  readonly subtitle?: string
}

export function SectionTitle({ children, subtitle }: SectionTitleProps) {
  return (
    <div className="mb-12 text-center">
      <h2 className="mb-3 text-3xl font-bold tracking-tight text-zinc-900 md:text-4xl">
        {children}
      </h2>
      {subtitle && (
        <p className="mx-auto max-w-2xl text-lg text-zinc-500">{subtitle}</p>
      )}
    </div>
  )
}
