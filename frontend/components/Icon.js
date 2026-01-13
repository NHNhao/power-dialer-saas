import React from 'react'

export default function Icon({ name, size=16, className='' }){
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', xmlns: 'http://www.w3.org/2000/svg' }
  switch(name){
    case 'phone':
      return (
        <svg {...common} className={className} stroke="currentColor"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.86 19.86 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.86 19.86 0 0 1 3.08 4.18 2 2 0 0 1 5 2h3a2 2 0 0 1 2 1.72c.12 1.05.38 2.07.76 3.03a2 2 0 0 1-.45 2.11L9.91 10.09a16 16 0 0 0 6 6l1.23-1.23a2 2 0 0 1 2.11-.45c.96.38 1.98.64 3.03.76A2 2 0 0 1 22 16.92z" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
      )
    case 'hangup':
      return (
        <svg {...common} className={className} stroke="currentColor"><path d="M21 15v2a2 2 0 0 1-2 2 16 16 0 0 1-14-8V9a2 2 0 0 1 2-2h2" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
      )
    case 'mute':
      return (
        <svg {...common} className={className} stroke="currentColor"><path d="M9 9v6h4l5 5V4l-5 5H9z" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
      )
    case 'user':
      return (
        <svg {...common} className={className} stroke="currentColor"><path d="M20 21v-2a4 4 0 0 0-3-3.87"/><path d="M4 21v-2a4 4 0 0 1 3-3.87"/><circle cx="12" cy="7" r="4"/></svg>
      )
    default:
      return null
  }
}
