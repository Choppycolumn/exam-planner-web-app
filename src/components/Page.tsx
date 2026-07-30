import type { ReactNode } from 'react';

export function Page({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="page-enter app-page">
      <header className="app-page-header">
        <div>
          <h1 className="app-page-title">{title}</h1>
          {subtitle ? <p className="app-page-subtitle">{subtitle}</p> : null}
        </div>
      </header>
      {children}
    </section>
  );
}
