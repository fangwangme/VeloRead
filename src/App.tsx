import { useState } from 'react'
import { Layout } from './components/Layout'
import { useThemeEffect } from './lib/hooks/useThemeEffect'
import { LibraryPage } from './pages/LibraryPage'
import { ReaderPage } from './pages/ReaderPage'

import { db } from './lib/db'

function App() {
  useThemeEffect()
  
  // Simple Router State
  const [currentView, setCurrentView] = useState<'library' | 'reader'>('library')
  const [activeBookId, setActiveBookId] = useState<string | null>(null)

  const handleOpenBook = (bookId: string) => {
      db.books.touch(bookId)
      setActiveBookId(bookId)
      setCurrentView('reader')
  }

  const handleBackToLibrary = () => {
      setActiveBookId(null)
      setCurrentView('library')
  }

  return (
    <Layout activeTab={currentView}>
      {currentView === 'library' && (
          <LibraryPage onOpenBook={handleOpenBook} />
      )}
      
      {currentView === 'reader' && activeBookId && (
          <ReaderPage bookId={activeBookId} onBack={handleBackToLibrary} />
      )}
    </Layout>
  )
}

export default App
