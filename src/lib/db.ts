import localforage from 'localforage'

export interface Book {
  id: string
  title: string
  author: string
  cover?: string 
  data: ArrayBuffer 
  addedAt: number
  lastRead?: number
  progress?: string 
  locations?: string // Serialized location data
}

// Config instance for books
const bookStore = localforage.createInstance({
  name: 'veloread',
  storeName: 'books'
})

export const db = {
  books: {
    add: async (book: Book) => {
      await bookStore.setItem(book.id, book)
      return book
    },
    getAll: async (): Promise<Book[]> => {
      const books: Book[] = []
      await bookStore.iterate((value: Book) => {
        books.push(value)
      })
      return books.sort((a, b) => b.addedAt - a.addedAt)
    },
    get: async (id: string): Promise<Book | null> => {
      return await bookStore.getItem<Book>(id)
    },
    delete: async (id: string) => {
      await bookStore.removeItem(id)
    },
    updateProgress: async (id: string, cfi: string) => {
       const book = await bookStore.getItem<Book>(id)
       if (book) {
         book.progress = cfi
         book.lastRead = Date.now()
         await bookStore.setItem(id, book)
       }
    },
    touch: async (id: string) => {
       const book = await bookStore.getItem<Book>(id)
       if (book) {
         book.lastRead = Date.now()
         await bookStore.setItem(id, book)
       }
    }
  }
}
