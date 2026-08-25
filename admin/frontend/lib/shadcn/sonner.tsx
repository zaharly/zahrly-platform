import React from 'react'
import { Toaster as Sonner } from 'sonner'

export const Toaster = (props: React.ComponentProps<typeof Sonner>) => <Sonner richColors position="bottom-right" {...props} />
