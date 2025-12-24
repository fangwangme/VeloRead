import { useState, useCallback } from 'react'
import { Upload } from 'lucide-react'
import { cn } from '../lib/utils'

interface DropZoneProps {
  onFileSelect: (file: File) => void
  isProcessing?: boolean
}

export function DropZone({ onFileSelect, isProcessing }: DropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false)

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0]
      if (file.type === 'application/epub+zip' || file.name.endsWith('.epub')) {
        onFileSelect(file)
      } else {
        alert('Please upload a valid EPUB file.')
      }
    }
  }, [onFileSelect])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onFileSelect(e.target.files[0])
    }
  }

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        "border border-dashed rounded-3xl p-10 flex flex-col items-center justify-center text-center transition-all cursor-pointer relative",
        isDragOver ? "border-primary bg-primary/5 shadow-2xl shadow-primary/5" : "border-border/60 hover:border-primary/40 hover:bg-secondary/30",
        isProcessing && "opacity-50 pointer-events-none"
      )}
    >
      <input 
        type="file" 
        accept=".epub" 
        className="absolute inset-0 opacity-0 cursor-pointer"
        onChange={handleInputChange}
        disabled={isProcessing}
      />
      
      <div className={cn(
        "w-10 h-10 rounded-2xl flex items-center justify-center mb-4 transition-all duration-500",
        isDragOver ? "bg-primary text-primary-foreground scale-110 rotate-3" : "bg-primary/5 text-primary/60"
      )}>
        <Upload className="w-5 h-5" />
      </div>
      
      {isProcessing ? (
        <p className="text-sm font-bold tracking-widest animate-pulse uppercase text-primary">Processing Library...</p>
      ) : (
        <div className="space-y-1">
            <p className="text-xl font-bold font-serif tracking-tight">Add to your collection</p>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/40">Drag & drop or Click to browse</p>
        </div>
      )}
    </div>
  )
}
