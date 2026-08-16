export type StyleId = 'book' | 'sepia' | 'modern' | 'journal' | 'news' | 'song'

export interface Palette {
  background: string
  text: string
  muted: string
  accent: string
  rule: string
  codeBackground: string
}

export interface BodyTypography {
  fontStack: string
  fontSizePx: number
  lineHeight: number
  measureCh: number
  align: 'start' | 'justify'
  hyphens: boolean
  paragraph: 'indent' | 'spaced'
  isCjk?: boolean
}

export interface ElementsTypography {
  headingFontStack: string
  headingScale: number[]
  headingWeight: number
  codeFontStack: string
  blockquote: 'indent' | 'rule'
  listIndentEm: number
  tableBorder: 'none' | 'horizontal' | 'all'
  figureCaptionScale: number
}

export interface ReadingStyle {
  id: StyleId
  name: string
  lightPalette: Palette
  darkPalette: Palette
  body: BodyTypography
  elements: ElementsTypography
}

export interface StyleOverride {
  fontStack?: string | null
  fontSizeStep?: number | null
  lineHeightStep?: number | null
  marginStep?: number | null
  bold?: boolean | null
  justify?: boolean | null
}

export interface ResolvedStyle {
  id: StyleId
  palette: Palette
  body: BodyTypography & {
    fontWeight?: number
  }
  elements: ElementsTypography
}
