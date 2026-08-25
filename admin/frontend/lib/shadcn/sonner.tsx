import React from 'react'
import { toast as sonnerToast, Toaster as Sonner } from 'sonner'

export const toast = sonnerToast
export const Toaster = (props: React.ComponentProps<typeof Sonner>) => (
  <Sonner richColors position="bottom-right" {...props} />
)
