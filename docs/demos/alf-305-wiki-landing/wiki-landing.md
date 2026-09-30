---
branch: claude/wiki-landing-page-revamp-yipa0r
---

# ALF-305: the wiki landing opens on a concept of the day and a live web

*2026-09-30T06:06:49.978Z*

`/wiki` now opens on the search box, today's **concept of the day**, and a live d3-force **web** of every concept and entity, with nothing below it. Sources and questions stay in the nav. The web's physics, view and gestures are ported from motivic and retuned for dots. Every shot below is the real app, running through the Playwright harness against the in-memory Supabase mock and seeded with the 52-page sample (`wikiWebFixtureSet`). The clock is pinned to 2026-10-03, the stories' day.

## The web settles, and a dragged node pulls its neighbours

With motion allowed, the first paint opens nearly settled: the sim pre-rolls headless to α 0.3, then relaxes one tick per frame. Desirable difficulty, today's concept, is pulled toward the middle. Its six neighbours sit out on a ring, lit violet and named. The page is scrolled to the web with a plain mouse wheel, which scrolls the page and doesn't zoom the web. Then John Medina is dragged by the mouse: his neighbours follow, and when he's let go the web settles again. The click that ends the drag doesn't open his page.

![The web settling on load, then a node dragged and released](wiki-landing-video-1.gif)

## At rest

From here on the app runs with reduced motion, so each still is the settled web. Top to bottom: the header, the search box, the concept-of-the-day card, then the **Concepts & entities** group with its count and the web. Nothing follows the web. A concept is a filled dot and an entity a ring, sized by its links. Today's concept wears the violet halo and a bold name, and its edges and neighbours are violet. Below 1:1 nobody else is named.

![](wiki-landing-image-2.png)

## Hover lights a neighbourhood

Hovering John Medina lights him, his edges and his six neighbours, and names them. Everything else dims, except the day's concept, which keeps its halo and name.

![](wiki-landing-image-3.png)

## Click opens the page, from a node or from the card

A click on John Medina's node opens his page in-app. The node is a real link, so ⌘/Ctrl-click opens a new tab.

![](wiki-landing-image-4.png)

Back on the landing, a click near the card's bottom-right corner, away from the title, opens the day's concept. The title is a stretched link, so the whole card clicks through while the link is still named by the title.

![](wiki-landing-image-5.png)

## Zoom, pan and Fit

A ⌘/Ctrl + wheel (or a trackpad pinch) zooms about the pointer. Past 1:1 every name that fits shows, with overlaps culled and the focus's name never culled. Dots and names keep their screen size, and a **Fit the web** button appears top-right.

![](wiki-landing-image-6.png)

A drag on empty stage pans the view.

![](wiki-landing-image-7.png)

Fit hands the view back to the fit of every dot, and the button goes.

![](wiki-landing-image-8.png)

## A plain wheel scrolls the page

The landing scrolls, so the web never captures a plain wheel. In a 640 px-tall window the page opens at the top. A plain wheel over the web then scrolls the page by 302 px, and the web doesn't zoom (no Fit button).

![](wiki-landing-image-9.png)

![](wiki-landing-image-10.png)

## The keyboard

The web is one tab stop. Tab from the search box passes the card, then lands on today's concept. Two presses of → walk to Elaboration in index order. It's lit like a hover and wears the focus ring round its dot.

![](wiki-landing-image-11.png)

Enter opens it.

![](wiki-landing-image-12.png)

## Search swaps the card and web for results

Typing "spaced" replaces the card and the web with the existing results. Title matches come first, then body matches (the body search is the mock backend's).

![](wiki-landing-image-13.png)

Clearing the box brings the card and the web back, laid out the same way, since the sim is seeded.

![](wiki-landing-image-14.png)

## Midnight rolls the day over in an open tab

The rotation is a pure function of the page index and the local date. It features the same concept all day, and every concept once before any repeats. Here the clock reads 23:59:40 on 3 October.

![](wiki-landing-image-15.png)

The clock then moves to 00:00:20 on 4 October, with no reload. Within a tick of the live clock the card and the web's focus move to the new day's concept, Second brain, and the web restarts warm around it. ("synced 10h ago" is the header reading the same clock.)

![](wiki-landing-image-16.png)

## No concepts or entities

A wiki of only sources and questions gets the search box and an empty state that points to the nav.

![](wiki-landing-image-17.png)

## On a phone

At 390 × 844 the stage is 320 px tall and nothing is wider than the screen. The hint reads "Pinch to zoom" on a coarse pointer.

![](wiki-landing-image-18.png)

A tap on a node opens it.

![](wiki-landing-image-19.png)

## The snapshot baselines this moves

The `Wiki/WikiView › Index` story is the landing over the small fixture wiki. Before, it showed the grouped lists; after, the card and a four-dot web (baseline | changed pixels | new render).

![](wiki-landing-image-20.png)

`SyncFailed` renders the same landing under a failed-sync header, so its baseline moves the same way. New baselines cover the full `Landing`, `LandingPhone` and `NoConceptsYet`, plus the web's `AtRest`, `ZoomedIn`, `NoFocus`, `OneNode` and `Hovering`.
