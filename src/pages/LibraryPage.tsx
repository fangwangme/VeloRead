import { useEffect, useState } from 'react'
import ePub from 'epubjs'
import { db, type Book } from '../lib/db'
import { DropZone } from '../components/DropZone'
import { Book as BookIcon, Trash2 } from 'lucide-react'
import { cn } from '../lib/utils'

interface LibraryPageProps {
  onOpenBook: (bookId: string) => void
}

export function LibraryPage({ onOpenBook }: LibraryPageProps) {
  const [books, setBooks] = useState<Book[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [sortType, setSortType] = useState<'addedAt' | 'title' | 'lastRead'>('lastRead')

  const loadBooks = async () => {
    const allBooks = await db.books.getAll()
    const sorted = [...allBooks].sort((a, b) => {
        if (sortType === 'title') {
            return a.title.localeCompare(b.title)
        } else if (sortType === 'lastRead') {
            return (b.lastRead || 0) - (a.lastRead || 0)
        } else {
            return (b.addedAt || 0) - (a.addedAt || 0)
        }
    })
    setBooks(sorted)
  }

  useEffect(() => {
    loadBooks()
  }, [sortType])

  const handleFileSelect = async (file: File) => {
    setIsProcessing(true)
    try {
      const arrayBuffer = await file.arrayBuffer()
      const book = ePub(arrayBuffer)
      
      const metadata = await book.loaded.metadata
      const coverUrl = await book.coverUrl()
      
      // Convert cover blob url to base64 or store blob if possible, 
      // but easiest is to fetch the blob content and store as base64 string for IDB
      let cover = ''
      if (coverUrl) {
         try {
             const response = await fetch(coverUrl)
             const blob = await response.blob()
             cover = await new Promise((resolve) => {
                 const reader = new FileReader()
                 reader.onloadend = () => resolve(reader.result as string)
                 reader.readAsDataURL(blob)
             })
         } catch (e) {
             console.warn('Failed to convert cover', e)
         }
      }

      const newBook: Book = {
        id: crypto.randomUUID(),
        title: metadata.title || file.name.replace('.epub', ''),
        author: metadata.creator || 'Unknown',
        cover: cover,
        data: arrayBuffer,
        addedAt: Date.now()
      }

      await db.books.add(newBook)
      await loadBooks()
      
    } catch (err) {
      console.error('Failed to parse EPUB', err)
      alert('Failed to parse this file.')
    } finally {
      setIsProcessing(false)
    }
  }
  
  const handleDelete = async (e: React.MouseEvent, id: string) => {
      e.stopPropagation()
      if (confirm('Are you sure you want to delete this book?')) {
          await db.books.delete(id)
          await loadBooks()
      }
  }

  return (
    <div className="max-w-6xl mx-auto space-y-8 py-4">
      <div className="flex items-end justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="text-4xl font-black font-serif tracking-tight text-foreground">Library</h2>
          <p className="text-[10px] font-bold text-muted-foreground/60 tracking-wider uppercase">Your personal collection</p>
        </div>

        <div className="flex items-center p-1 bg-secondary/40 rounded-xl border border-border/40">
           {[
             { id: 'lastRead', label: 'Recent' },
             { id: 'addedAt', label: 'Added' },
             { id: 'title', label: 'A-Z' }
           ].map(opt => (
             <button
                key={opt.id}
                onClick={() => setSortType(opt.id as any)}
                className={cn(
                    "px-4 py-1.5 rounded-lg text-[11px] font-bold transition-all",
                    sortType === opt.id 
                        ? "bg-background text-foreground shadow-sm ring-1 ring-black/5" 
                        : "text-muted-foreground hover:text-foreground hover:bg-background/40"
                )}
             >
                {opt.label}
             </button>
           ))}
        </div>
      </div>

      <div className="pt-4">
        <DropZone onFileSelect={handleFileSelect} isProcessing={isProcessing} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-x-8 gap-y-12 mt-6">
        {books.map((book) => (
          <div 
            key={book.id} 
            onClick={() => onOpenBook(book.id)}
            className="group relative flex flex-col gap-4 cursor-pointer"
          >
            <div className="aspect-[2/3] relative bg-secondary/30 rounded-lg overflow-hidden shadow-sm transition-all duration-500 group-hover:shadow-2xl group-hover:shadow-primary/10 group-hover:-translate-y-2 border border-border/50">
              {book.cover ? (
                <img src={book.cover} alt={book.title} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center text-muted-foreground bg-secondary/20">
                  <BookIcon className="w-12 h-12 mb-3 opacity-20" />
                  <span className="text-[10px] font-bold uppercase tracking-tighter line-clamp-2 px-2">{book.title}</span>
                </div>
              )}
              
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 flex items-end p-4">
                  <span className="text-[10px] font-bold text-white/80 uppercase tracking-widest">Open Reader</span>
              </div>

              <button 
                onClick={(e) => handleDelete(e, book.id)}
                className="absolute top-3 right-3 p-2.5 bg-background/90 backdrop-blur-md rounded-full opacity-0 group-hover:opacity-100 transition-all duration-300 hover:bg-destructive hover:text-white transform translate-y-2 group-hover:translate-y-0"
              >
                  <Trash2 className="w-4 h-4" />
              </button>
            </div>
            
            <div className="space-y-1.5 px-0.5">
              <h3 className="font-bold text-sm leading-snug line-clamp-2 text-foreground/90 group-hover:text-primary transition-colors">{book.title}</h3>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80 truncate">{book.author}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
