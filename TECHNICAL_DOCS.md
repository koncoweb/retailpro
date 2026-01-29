# RetailPro - Technical Documentation

## 1. Inventory Management Enhancements

### 1.1 Automatic SKU Generation

**Overview:**
The system now supports automatic generation of Stock Keeping Units (SKU) to ensure uniqueness and consistency.

**Format:**
`PREFIX-YYYYMMDD-SEQ`
- **PREFIX**: First 3 alphanumeric characters of the Category name (uppercased). Non-alphanumeric characters are replaced or padded to ensure 3 chars.
- **YYYYMMDD**: Current date in ISO format.
- **SEQ**: 3-digit sequence number (001, 002, ...), auto-incremented based on the last existing SKU for that pattern in the database.

**Implementation Details:**
- **File**: `src/lib/inventory-utils.ts` (Core logic), `src/components/inventory/AddProductModal.tsx` (UI integration).
- **Logic**: 
  1. Frontend calculates the base pattern (e.g., `ELE-20231025-%`).
  2. Queries the database (`products` table) for the latest SKU matching this pattern.
  3. Parses the sequence number from the result.
  4. Generates the new SKU using `generateNextSku` utility function.
- **Testing**: Unit tests available in `src/lib/inventory-utils.test.ts`.

### 1.2 Searchable Dropdowns (Category & Supplier)

**Overview:**
Replaced standard select inputs with searchable "Combobox" components to handle large datasets efficiently.

**Features:**
- **Search**: Real-time filtering of categories/suppliers as user types.
- **Auto-Add**: If a user searches for a category/supplier that doesn't exist, they can add it immediately.
- **Database Sync**: New entries are saved to `categories` or `suppliers` tables upon product submission to ensure data integrity.

**Components Used:**
- Shadcn UI `Command`, `Popover`.
- `CommandInput` for search field.
- `CommandList`, `CommandGroup`, `CommandItem` for results.

**Data Flow:**
1. Component mounts -> Fetches `categories` and `suppliers` from DB via SQL query.
2. User types -> `Command` component filters local list.
3. User selects "Add New" -> Prompt appears -> New item added to local state list.
4. Form Submit -> Checks if category exists in DB -> Inserts if new (`INSERT ... ON CONFLICT DO NOTHING`).

### 1.3 Barcode Generation

**Overview:**
Automatic barcode generation for product units.

**Features:**
- **Generation**: Uses `react-barcode` library.
- **Preview**: Visual rendering of the barcode in the modal.
- **Download**: Button to download the barcode as a PNG image.

**Implementation:**
- **Library**: `react-barcode`
- **Download Logic**: Renders the SVG/Canvas to a Data URL and triggers a browser download.

## 2. Testing

**Framework**: Vitest + React Testing Library

**Running Tests:**
```bash
npx vitest run
```

**Coverage:**
- `src/lib/inventory-utils.test.ts`: Covers SKU generation logic, edge cases (short names, special chars), and barcode validation.

## 3. Database Schema Updates

### 3.1 New Tables
- **categories**: Stores product categories.
  - `id` (UUID, PK)
  - `name` (Unique)
- **suppliers**: Stores supplier information.
  - `id` (UUID, PK)
  - `name` (String)
  - `tenant_id` (UUID)

Ensure these tables exist for the dropdown features to work correctly.
