import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * Catches a render-time throw so it does not take the whole window with it.
 *
 * Without one, any exception inside render unmounts the tree and leaves a blank
 * window — no toolbar, no way back to the library, nothing to click. For an app
 * you keep open for an hour at a time that is the difference between "this book
 * failed to open" and "the app is gone".
 *
 * Rendering, not async: promise rejections and event handlers do not reach an
 * error boundary, and the code paths that talk to storage or epub.js already
 * catch their own.
 */
export class ErrorBoundary extends Component<
  {
    children: ReactNode
    /** Rendered in place of the subtree. `retry` remounts it. */
    fallback: (error: Error, retry: () => void) => ReactNode
  },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // The only place this is recoverable from is the console, so put it there
    // rather than swallowing it into the fallback's message alone.
    console.error('VeloRead crashed while rendering', error, info.componentStack)
  }

  private retry = () => this.setState({ error: null })

  render() {
    const { error } = this.state
    if (error) return this.props.fallback(error, this.retry)
    return this.props.children
  }
}
