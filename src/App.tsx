import { useEffect } from 'react'
import { useLibrary } from './library/store'
import { Library } from './library/Library'
import { Reader } from './reader/Reader'

export default function App() {
  const view = useLibrary((s) => s.view)
  const load = useLibrary((s) => s.load)

  useEffect(() => {
    void load()
  }, [load])

  if (view.name === 'reader') {
    return <Reader key={view.bookId} bookId={view.bookId} />
  }
  return <Library />
}
