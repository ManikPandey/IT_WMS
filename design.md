

# IT_WMS — Design Brief

**Style:** Clean SaaS dashboard (Linear/Vercel-inspired). Dark sidebar + light content area. One accent color (blue or teal). Generous whitespace. Monospace font for asset tags/IDs.

## Pages

1. **Login** — centered card, email + password, single accent-color submit button.
2. **Dashboard** — 4 stat cards on top (Total Assets, In Stock, Deployed, Pending POs) + recent audit activity feed below.
3. **Inventory** — data table (Asset Tag, Type, Status badge, Assigned To, Actions) with status filter dropdown + "Allocate Asset" button opening a modal.
4. **Purchase Orders** — data table (PO ID, Vendor, Budget, Status, Actions) + "Create PO" button opening a form modal; "Approve" action per row.
5. **Audit Log** — chronological table/feed (Timestamp, Event Type, Entity, Details), filterable by entity type.

## Shared Components

- **Sidebar nav**: Dashboard, Inventory, Purchase Orders, Audit Log — icon + label, active state highlighted.
- **Topbar**: user role badge + logout.
- **StatusBadge**: color-coded pill — IN_STOCK green, DEPLOYED blue, MAINTENANCE amber, IN_TRANSIT purple, SCRAPPED gray.
- **DataTable**: sortable columns, pagination, empty state.
- **Modal**: for Allocate Asset and Create PO forms.
- **Toast**: top-right, success/error (e.g. "Out of stock", "Duplicate request blocked").
- **Loading skeleton**: for table rows and stat cards (backend has cold-start delay).

## Layout

Sidebar (fixed, ~220px) + main content area (max-width ~1200px, centered, padded). Cards use subtle border + shadow, rounded-lg corners.



Screens
Overview Dashboard: High-level metrics, active alerts, and recent procurement status
Asset Inventory: Filterable, paginated list of all hardware/software with quick-actions
Asset Detail: Deep dive into a specific asset's lifecycle, assignment, and warranty
Procurement Tracking: Kanban-style or strict list view of pending approvals, orders, and receiving

Key Flows
Approve Procurement Request: Manager reviews and approves a pending hardware request
User is on Overview Dashboard -> sees 3 Pending Approvals in the Quick Actions section
User clicks Review button -> modal opens with request details
User clicks Approve Order -> modal closes, toast notification confirms, count drops to 2
Audit Asset Assignment: IT Admin verifies who holds a specific MacBook Pro
User is on Asset Inventory -> searches MAC-2023-084
User clicks row -> navigates to Asset Detail
User views Assigned To card -> sees current employee details and assignment date
Design System

Color Palette
Primary: #4338CA - Buttons, active states, key data highlights (Deep Indigo)
Background: #FFFFFF - Page background, main canvas
Surface: #FAFAFA - Secondary areas, table headers, subtle contrasts
Text: #171717 - Primary headings, body copy
Muted: #8F8F8F - Secondary text, timestamps, empty states
Border: #EAEAEA - Dividers, input outlines
Accent/Success: #10B981 - Active status, successful deployments
Accent/Warning: #F59E0B - Expiring warranties, pending states

Typography
Headings: Geist, 600, 24px-32px, tracking -0.02em
Body: Geist, 400, 14px
Monospace/Data: Geist Mono, 500, 13px (Asset IDs, MAC addresses, pricing)
Buttons: Geist, 500, 14px
Style notes: 6px border radius on all interactive elements. 1px solid #EAEAEA borders instead of drop shadows for depth. Generous 32px padding on sections. Absolute minimalism.

Design Tokens
:root {
  --color-primary: #4338CA;
  --color-background: #FFFFFF;
  --color-surface: #FAFAFA;
  --color-text: #171717;
  --color-muted: #8F8F8F;
  --color-border: #EAEAEA;
  --font-primary: 'Geist', sans-serif;
  --font-mono: 'Geist Mono', monospace;
  --radius: 6px;
  --spacing-sm: 8px;
  --spacing-md: 16px;
  --spacing-lg: 32px;
}

[data-theme='dark'] {
  --color-primary: #818cf8;
  --color-background: #0a0a0a;
  --color-surface: #171717;
  --color-text: #f5f5f5;
  --color-muted: #a3a3a3;
  --color-border: #262626;
}

Screen Specifications
Overview Dashboard
Purpose: Provide immediate situational awareness of IT assets and procurement blocks.
Layout: Top navigation bar. 3-column metric grid at the top. 2-column split below (Recent Alerts left, Procurement Pipeline right).
Key Elements:
Metric Cards: 1px border, #FFFFFF bg, large Geist Mono integers (42, $14,200), muted labels.
Alert List: Stacked rows, no internal borders. 8px left border for severity (Indigo for info, Amber for warning).
Global Search: 40px height input, centered in nav, / shortcut hint.

States:
Empty: "No active alerts" centered text, #8F8F8F.
Loading: Skeleton pulses, #FAFAFA to #EAEAEA.

Components:
Status Badge: 24px height, 12px font, 4px radius.
Interactions:
Hover row: Background changes to #FAFAFA.

Responsive:
Desktop: Full grid.
Asset Inventory
Purpose: Comprehensive, easily filterable database of all IT holdings.
Layout: Header with filters and search. Full-width data table filling the remaining viewport.

Key Elements:
Data Table: Flush to edges, 48px row height. Column headers #FAFAFA bg, 12px Geist, #8F8F8F.
Asset Tags: Rendered in Geist Mono, #171717.
Filters: Dropdown buttons, 32px height, 1px border.

States:
Empty: Illustration-free. Just text: "No assets match these filters." Button to "Clear filters".
Loading: 10 skeleton rows.
Interactions:

Click row: Navigates to Asset Detail.
Responsive:
Desktop: 8 columns visible.
Asset Detail
Purpose: Single source of truth for an individual piece of hardware or software seat.
Layout: Breadcrumb top. Two-column layout (Main details 70%, Sidebar 30%).
Key Elements:
Header: Asset ID prominently displayed in 32px Geist Mono.
Specs List: Key/value pairs. Keys #8F8F8F, Values #171717.
Action Bar: Primary Indigo button "Reassign", secondary button "Report Issue".

Components:
Lifecycle Timeline: Vertical line with dots detailing purchase, assignment, and repair history.
Interactions:
Click Timeline Item: Expands inline to show notes.
Responsive:
Desktop: Side-by-side layout.
Procurement Tracking
Purpose: Manage the pipeline of requested, ordered, and receiving IT goods.
Layout: Horizontal pipeline view (Kanban). 4 columns: Requested, Approved, Ordered, Received.
Key Elements:
Pipeline Columns: #FAFAFA background, 1px border, 320px fixed width.
Order Cards: #FFFFFF background, display Request ID (Mono), Item Name, Assignee avatar, and cost.

States:
Empty Column: Dashed border outline dropzone.
Interactions:
Hover Card: 1px border turns #4338CA.
Drag & Drop: Move cards between columns.
Responsive:
Desktop: Horizontal scroll if columns exceed viewport width.
Overview Dashboard - Establishes the core layout shell, navigation, font loading (Geist/Geist Mono), and basic card components.
Asset Inventory - Defines the dense data table patterns and interactive filter states.
Asset Detail - Establishes typographic hierarchy for key/value pairs and timeline components.
Procurement Tracking - Introduces the horizontal drag-and-drop Kanban interface.