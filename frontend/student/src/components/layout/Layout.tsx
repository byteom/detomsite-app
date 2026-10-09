import React from 'react'
import { Navbar } from './Navbar'
import { MobileNav } from './MobileNav'
import { Footer } from './Footer'
import { StickyCartBar } from '../food/StickyCartBar'

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 selection:bg-emerald-100 selection:text-emerald-900">
      <Navbar />
      <main className="flex-1 w-full">{children}</main>
      <StickyCartBar />
      <MobileNav />
      <Footer />
    </div>
  )
}
