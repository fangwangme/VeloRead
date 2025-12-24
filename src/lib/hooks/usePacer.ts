import { useEffect, useRef, useState } from "react";
import { Rendition } from "epubjs";
import { useSettingsStore } from "../store";
import { useShallow } from "zustand/react/shallow";

// Check if text is primarily CJK (Chinese, Japanese, Korean)
function isCJKText(text: string): boolean {
  const cjkRegex =
    /[\u4E00-\u9FFF\u3400-\u4DBF\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF]/g;
  const matches = text.match(cjkRegex);
  if (!matches) return false;
  return matches.length / text.length > 0.3;
}

// Number of words/chunks to highlight at once
const ENGLISH_CHUNK_SIZE = 3; // Scientific optimal: ~3 words per fixation
const CJK_CHUNK_SIZE = 8; // 8 characters at a time for CJK

export function usePacer(rendition: Rendition | null, isReady: boolean) {
  const {
    isPacerPlaying,
    wpm,
    pacerStartIndex,
    setPacerStartIndex,
    appTheme,
    pacerChunkSize,
    pacerActionKey,
    setPacerActionKey,
    setPacerWordIndex,
  } = useSettingsStore(
    useShallow((s) => ({
      isPacerPlaying: s.isPacerPlaying,
      wpm: s.wpm,
      pacerStartIndex: s.pacerStartIndex,
      setPacerStartIndex: s.setPacerStartIndex,
      appTheme: s.appTheme,
      pacerChunkSize: s.pacerChunkSize,
      pacerActionKey: s.pacerActionKey,
      setPacerActionKey: s.setPacerActionKey,
      setPacerWordIndex: s.setPacerWordIndex,
    }))
  );
  const timeoutRef = useRef<any>(null);
  const isTurningPage = useRef(false);
  const [renderCount, setRenderCount] = useState(0);

  // CRITICAL: Use refs to store values that should not trigger effect re-runs
  // but need to be read in real-time within nextGroup
  const isPacerPlayingRef = useRef(isPacerPlaying);
  const wpmRef = useRef(wpm);

  // Keep refs in sync with state
  useEffect(() => {
    isPacerPlayingRef.current = isPacerPlaying;
  }, [isPacerPlaying]);

  useEffect(() => {
    wpmRef.current = wpm;
  }, [wpm]);

  // Clean up function
  const cleanUp = (doc: Document) => {
    if (!doc) return;
    doc
      .querySelectorAll(".pacer-active")
      .forEach((el) => el.classList.remove("pacer-active"));
  };

  // Handle page changes lifecycle
  useEffect(() => {
    if (!rendition) return;

    const handleRelocate = () => {
      console.log('[Pacer] handleRelocate called, isPacerPlaying:', useSettingsStore.getState().isPacerPlaying);
      // Reset page turn lock and force re-render - this is the primary trigger
      isTurningPage.current = false;
      if (useSettingsStore.getState().isPacerPlaying) {
        setPacerWordIndex(0);
        console.log('[Pacer] Reset pacerWordIndex to 0, incrementing renderCount');
        setRenderCount((c) => c + 1);
      }
    };

    const handleRendered = () => {
      console.log('[Pacer] handleRendered called');
      // Redundant safety: also reset here in case relocated didn't fire
      isTurningPage.current = false;
    };

    rendition.on("relocated", handleRelocate);
    rendition.on("rendered", handleRendered);

    return () => {
      rendition.off("relocated", handleRelocate);
      rendition.off("rendered", handleRendered);
    };
  }, [rendition]);

  // Effect to handle isPacerPlaying changes: start or stop the pacer loop
  useEffect(() => {
    if (isPacerPlaying) {
      // When pacer starts playing, trigger re-initialization
      console.log('[Pacer] isPacerPlaying changed to true, triggering renderCount++');
      setRenderCount(c => c + 1);
    } else {
      // When pacer stops, clear the timeout
      console.log('[Pacer] isPacerPlaying changed to false, clearing timeout');
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    }
  }, [isPacerPlaying]);

  // Main effect: Initialize pacer on page ready or after page turn
  // IMPORTANT: isPacerPlaying is NOT in dependencies to avoid re-running on pause/resume
  useEffect(() => {
    console.log('[Pacer] Main effect triggered. isReady:', isReady, 'isTurningPage:', isTurningPage.current, 'renderCount:', renderCount);
    if (!rendition || !isReady || isTurningPage.current) {
      console.log('[Pacer] Early exit from main effect.');
      return;
    }

    // Check isPacerPlaying from ref (not from closure)
    if (!isPacerPlayingRef.current) {
      console.log('[Pacer] Pacer not playing, skipping initialization');
      return;
    }

    // Get current index from store ONLY on mount/trigger
    const currentStoreIndex = useSettingsStore.getState().pacerWordIndex;
    let activeGroupIndex =
      pacerStartIndex > 0
        ? Math.floor(pacerStartIndex / ENGLISH_CHUNK_SIZE)
        : currentStoreIndex;
    console.log('[Pacer] Starting with activeGroupIndex:', activeGroupIndex);
    if (pacerStartIndex > 0) setPacerStartIndex(0);

    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    let wordGroups: HTMLElement[][] = [];
    let isCJK = false;
    let currentDoc: Document | null = null;

    const initPage = () => {
      const contentList = rendition.getContents() as any;
      const contents =
        contentList && contentList.length > 0 ? contentList[0] : null;
      if (!contents) {
        console.log('[Pacer] initPage: No contents found');
        return false;
      }

      const doc = contents.document;
      currentDoc = doc;
      if (!doc || !doc.body) {
        console.log('[Pacer] initPage: No doc or body');
        return false;
      }

      const sampleText = doc.body.textContent?.slice(0, 500) || "";
      isCJK = isCJKText(sampleText);
      const chunkSize = isCJK ? CJK_CHUNK_SIZE : pacerChunkSize;

      // CRITICAL: On page turn (renderCount > 0), we MUST re-wrap fresh content
      // because old .pacer-word spans reference stale DOM nodes
      const existingPacerWords = doc.querySelectorAll(".pacer-word");
      const shouldRewrap = existingPacerWords.length === 0 || renderCount > 0;

      console.log('[Pacer] initPage: existingPacerWords:', existingPacerWords.length, 'shouldRewrap:', shouldRewrap, 'renderCount:', renderCount);

      if (shouldRewrap) {
        const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
          acceptNode: (node: Node) => {
            if (
              node.parentElement?.tagName === "RT" ||
              node.parentElement?.classList.contains("pacer-word")
            )
              return NodeFilter.FILTER_REJECT;
            if (node.textContent?.trim().length === 0)
              return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
          },
        });
        const nodes: Node[] = [];
        let node;
        while ((node = walker.nextNode())) nodes.push(node);
        nodes.forEach((textNode) => {
          const parent = textNode.parentNode;
          if (!parent || ["SCRIPT", "STYLE", "TITLE"].includes(parent.nodeName))
            return;
          const text = textNode.textContent || "";
          const fragment = doc.createDocumentFragment();
          if (isCJK) {
            for (const char of text) {
              if (char.trim()) {
                const span = doc.createElement("span");
                span.className = "pacer-word";
                span.textContent = char;
                fragment.appendChild(span);
              } else fragment.appendChild(doc.createTextNode(char));
            }
          } else {
            text.split(/(\s+)/).forEach((part) => {
              if (part.trim()) {
                const span = doc.createElement("span");
                span.className = "pacer-word";
                span.textContent = part;
                fragment.appendChild(span);
              } else fragment.appendChild(doc.createTextNode(part));
            });
          }
          parent.replaceChild(fragment, textNode);
        });
      }

      // 2. Line-Aware Grouping
      const allSpans = Array.from(
        doc.querySelectorAll(".pacer-word")
      ) as HTMLElement[];
      wordGroups = [];
      let currentGroup: HTMLElement[] = [];
      let lastTop = -1;
      allSpans.forEach((span) => {
        const rect = span.getBoundingClientRect();
        const top = Math.round(rect.top);
        const isNewLine = lastTop !== -1 && Math.abs(top - lastTop) > 5;
        if (currentGroup.length >= chunkSize || isNewLine) {
          if (currentGroup.length > 0) wordGroups.push(currentGroup);
          currentGroup = [];
        }
        currentGroup.push(span);
        lastTop = top;
      });
      if (currentGroup.length > 0) wordGroups.push(currentGroup);

      // 3. Styles - using bright red for debugging
      console.log('[Pacer] Injecting CSS styles into iframe');
      contents.addStylesheetRules({
        ".pacer-active": {
          "border-bottom": "5px solid red !important",
          "background-color": "rgba(255,0,0,0.1) !important",
          "text-decoration": "none !important",
        },
        ".pacer-word": { cursor: "pointer" },
      });

      // 4. Click to jump
      doc.body.onclick = (e: MouseEvent) => {
        const target = (e.target as HTMLElement).closest(
          ".pacer-word"
        ) as HTMLElement;
        if (target) {
          const foundGIdx = wordGroups.findIndex((group) =>
            group.includes(target)
          );
          if (foundGIdx >= 0) {
            cleanUp(doc);
            setPacerWordIndex(foundGIdx);
            setPacerActionKey(Date.now());
            target.classList.add("pacer-active");
          }
        }
      };
      return true;
    };

    const initResult = initPage();
    console.log('[Pacer] initPage result:', initResult, 'wordGroups length:', wordGroups.length);
    if (!initResult) return;

    const nextGroup = () => {
      // CRITICAL: Read isPacerPlaying from ref in real-time, not from closure
      // This prevents stale closure values and ensures we respond to pause immediately
      const currentIsPacerPlaying = isPacerPlayingRef.current;
      console.log('[Pacer] nextGroup called. isPacerPlaying:', currentIsPacerPlaying, 'isTurningPage:', isTurningPage.current, 'activeGroupIndex:', activeGroupIndex, 'wordGroups.length:', wordGroups.length);
      if (!currentIsPacerPlaying || isTurningPage.current) {
        console.log('[Pacer] nextGroup early exit');
        return;
      }

      // 1. Check if section is empty or end reached
      if (wordGroups.length === 0 || activeGroupIndex >= wordGroups.length) {
        console.log('[Pacer] End of section or empty, calling rendition.next()');
        isTurningPage.current = true
        // Small delay to let user see last word before flipping
        timeoutRef.current = setTimeout(() => {
          if (rendition) rendition.next()
        }, wordGroups.length === 0 ? 500 : 300)
        return
      }

      const doc = currentDoc
      if (!doc) return

      // Get epubjs container and its scroll position for accurate visibility detection
      const manager = (rendition as any).manager
      const container = manager?.container
      const containerWidth = container?.offsetWidth || 800
      const containerScrollLeft = container?.scrollLeft || 0

      // Also check iframe body scroll and transforms - epubjs might use different methods
      const iframeBody = doc.body
      const bodyScrollLeft = iframeBody?.scrollLeft || 0
      const docElementScrollLeft = doc.documentElement?.scrollLeft || 0

      // Check if epubjs uses CSS transform for pagination
      const containerStyle = container ? getComputedStyle(container) : null
      const transformValue = containerStyle?.transform

      // Get the actual view from epubjs
      const views = manager?.views
      const currentView = views?._views?.[0] || views?.first?.()
      const viewElement = currentView?.element
      const viewScrollLeft = viewElement?.scrollLeft || 0

      // Determine the effective scroll position
      const scrollLeft = containerScrollLeft || bodyScrollLeft || docElementScrollLeft || viewScrollLeft

      // Log comprehensive debug info on first call after page turn
      if (activeGroupIndex === 0) {
        console.log('[Pacer] Coordinate debug:', {
          containerScrollLeft,
          bodyScrollLeft,
          docElementScrollLeft,
          viewScrollLeft,
          containerWidth,
          transformValue,
          effectiveScrollLeft: scrollLeft
        })
      }

      // CRITICAL FIX: Use offsetLeft to get the element's ACTUAL position in the content
      // getBoundingClientRect() gives position relative to iframe viewport, which doesn't work
      // because the iframe viewport doesn't scroll - the container does.
      // offsetLeft gives the element's position relative to its offsetParent, which we can
      // accumulate to get the absolute position in the content.

      // Helper function to get absolute left position
      const getAbsoluteLeft = (el: HTMLElement): number => {
        let left = 0
        let current: HTMLElement | null = el
        while (current) {
          left += current.offsetLeft
          current = current.offsetParent as HTMLElement | null
        }
        return left
      }

      // 2. Find the first VISIBLE group by calculating actual content position
      let group = wordGroups[activeGroupIndex]
      while (group && activeGroupIndex < wordGroups.length) {
        const element = group[0]

        // Get actual position in content using offsetLeft
        const absoluteLeft = getAbsoluteLeft(element)
        const elementWidth = element.offsetWidth
        const absoluteRight = absoluteLeft + elementWidth

        // Visible range in content coordinates
        const visibleLeft = scrollLeft
        const visibleRight = scrollLeft + containerWidth

        // Log first few iterations for debugging
        if (activeGroupIndex < 5 || activeGroupIndex % 20 === 0) {
          console.log('[Pacer] Visibility check:', {
            index: activeGroupIndex,
            absoluteLeft: Math.round(absoluteLeft),
            absoluteRight: Math.round(absoluteRight),
            visibleLeft,
            visibleRight: Math.round(visibleRight),
            scrollLeft,
            isVisible: absoluteLeft >= visibleLeft && absoluteLeft < visibleRight
          })
        }

        // If group is BEFORE visible range (previous pages), skip it
        if (absoluteRight < visibleLeft) {
          activeGroupIndex++
          group = wordGroups[activeGroupIndex]
          continue
        }

        // If group is AFTER visible range (next page), turn page
        if (absoluteLeft >= visibleRight - 15) {
          console.log('[Pacer] Group off-screen-right, calling rendition.next()');
          isTurningPage.current = true
          rendition.next()
          return
        }

        // Group is VISIBLE - highlight it!
        break
      }

      if (!group) {
        console.log('[Pacer] No visible group found, calling rendition.next()');
        isTurningPage.current = true
        rendition.next()
        return
      }

      cleanUp(doc)

      // Debug: Verify elements are valid and check computed style
      const firstEl = group[0]
      console.log('[Pacer] Element check:', {
        isConnected: firstEl.isConnected,
        textContent: firstEl.textContent?.slice(0, 20),
        classNameBefore: firstEl.className,
        parentNode: firstEl.parentNode?.nodeName
      })

      group.forEach(span => span.classList.add('pacer-active'))

      // Verify class was added and check computed style
      const computedBorder = doc.defaultView?.getComputedStyle(firstEl).borderBottom
      console.log('[Pacer] After highlight:', {
        classNameAfter: firstEl.className,
        computedBorder: computedBorder,
        hasPacerActive: firstEl.classList.contains('pacer-active')
      })

      console.log('[Pacer] Highlighted group at index:', activeGroupIndex)

      // 3. Timing calculation - read wpm from ref for real-time value
      const currentWpm = wpmRef.current
      const delay = Math.max((group.length * (isCJK ? 0.5 : 1) / currentWpm) * 60000, 160)
      activeGroupIndex++

      // Sync to store for progress UI, but hook won't re-render due to selector
      setPacerWordIndex(activeGroupIndex)

      timeoutRef.current = setTimeout(nextGroup, delay)
    }

    // Start delay to avoid rendition race - give epubjs time to render new page
    const startTimeout = setTimeout(nextGroup, 350)

    return () => {
      clearTimeout(startTimeout)
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }

  }, [isReady, rendition, appTheme, pacerChunkSize, renderCount]) // isPacerPlaying and wpm are NOT in dependencies - we use refs

  // Dedicated effect to handle click-to-jump via pacerActionKey
  useEffect(() => {
    if (!rendition || !isReady || pacerActionKey === 0) return;
    // Trigger re-initialization when user clicks on a word
    setRenderCount(c => c + 1);
  }, [pacerActionKey, rendition, isReady]);
}
