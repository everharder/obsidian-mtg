# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an Obsidian plugin for managing Magic: The Gathering (MtG) card collections and decklists. The plugin allows users to:
- Define decklists using `mtg-deck` code blocks in Markdown files
- Create general card lists using `mtg-list` code blocks for inventories, wishlists, trade binders, etc.
- Track card collections via CSV files with configurable extensions (default: `.mtg.collection.csv`)
- Display card prices, images, and purchase links via Scryfall API integration
- Show collection ownership counts alongside decklist cards

## Development Commands

```bash
# Development with hot reload
npm run dev

# Testing
npm test

# Linting and formatting
npm run lint
npm run format
npm run format-check

# Full verification (tests + lint + format check)
npm run verify

# Production build with type checking
npm run build

# Version bump (updates manifest.json and versions.json)
npm run version
```

## Architecture

### Core Components

- **main.ts**: Plugin entry point, registers the `mtg-deck` code block processor and settings tab
- **src/renderer.ts**: Handles parsing and rendering of deck lists, integrates with Scryfall API for card data
- **src/collection.ts**: Manages CSV collection file parsing and card count synchronization
- **src/scryfall.ts**: Scryfall API client for fetching card data, prices, and images
- **src/settings.ts**: TypeScript interfaces for plugin configuration
- **src/csv.ts**: CSV parsing utilities for collection files

### Key Data Flow

1. Plugin loads and syncs card counts from CSV collection files
2. When `mtg-deck` or `mtg-list` code blocks are processed:
   - Parse list text into card entries
   - Fetch card data from Scryfall API in batches (max 75 cards)
   - Render HTML with card counts, prices, and purchase links
   - Apply user settings (currency, visibility options)
   - For `mtg-deck`: include buylist functionality for missing cards
   - For `mtg-list`: simpler rendering without buylist features

### File Structure Conventions

- Main plugin code in `main.ts`
- Source modules in `src/` directory
- Tests colocated with source files using `.spec.ts` suffix
- Jest configuration in `jest.config.js` with jsdom environment
- ESBuild configuration in `esbuild.config.mjs` for bundling

### Settings Architecture

Settings are stored in the `ObsidianPluginMtgSettings` interface with two main sections:
- `collection`: CSV file handling (file extension, column names, sync interval)
- `decklist`: Display preferences (currency, hyperlinks, previews, buylist, price visibility)

## Important Notes

- Collection CSV files are auto-synced when modified (watched via Obsidian's vault.on("modify"))
- Scryfall API has a 75-card batch limit for requests
- Card names are normalized to lowercase for consistent matching between collections and decklists
- Double-faced cards are handled by splitting on "//" and using the first face name
- The plugin maintains an in-memory `cardCounts` record for performance