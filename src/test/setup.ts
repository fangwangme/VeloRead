// jsdom ships no IndexedDB, so the web storage port is tested against an
// in-memory implementation of the real API rather than a hand-written stub.
import 'fake-indexeddb/auto'
