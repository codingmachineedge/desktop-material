import * as React from 'react'

import {
  CatalogPageSizeOptions,
  ICatalogPage,
} from '../../lib/catalog-pagination'

interface ICatalogPaginationProps {
  /** The resolved page window (see `paginateCatalog`). */
  readonly page: ICatalogPage
  /** Accessible label for the surrounding `nav` landmark. */
  readonly navLabel: string
  /** Visible label for the page-size selector. */
  readonly pageSizeLabel: string
  /** Unique id wiring the page-size `<label>` to its `<select>`. */
  readonly pageSizeInputId: string
  /** When true, every control is disabled (for example while loading). */
  readonly disabled?: boolean
  /**
   * Invoked when a First/Previous/Next/Last button is pressed. The target page
   * is carried on the button's `data-page` attribute so a single bound handler
   * can serve every control without violating `react/jsx-no-bind`.
   */
  readonly onPageChange: (event: React.MouseEvent<HTMLButtonElement>) => void
  /** Invoked when the page-size selector changes. */
  readonly onPageSizeChange: (
    event: React.ChangeEvent<HTMLSelectElement>
  ) => void
}

/**
 * Reusable First / Previous / Next / Last pagination controls with a page-size
 * selector, shared by every product catalog (GitHub REST + GraphQL operations,
 * the `.gitignore` template catalog, …). It is purely presentational: the page
 * window is computed by `paginateCatalog` and navigation is reported back to the
 * owner, which holds the page state.
 */
export class CatalogPagination extends React.Component<ICatalogPaginationProps> {
  public render() {
    const {
      page,
      navLabel,
      pageSizeLabel,
      pageSizeInputId,
      onPageChange,
      onPageSizeChange,
    } = this.props
    const disabled = this.props.disabled === true
    return (
      <nav className="catalog-pagination" aria-label={navLabel}>
        <div className="catalog-pagination-controls">
          <button
            type="button"
            data-page="1"
            disabled={disabled || !page.hasPrevious}
            aria-label="First page"
            onClick={onPageChange}
          >
            « First
          </button>
          <button
            type="button"
            data-page={page.page - 1}
            disabled={disabled || !page.hasPrevious}
            aria-label="Previous page"
            onClick={onPageChange}
          >
            ‹ Prev
          </button>
          <span aria-live="polite">
            Page {page.page} of {page.pageCount}
          </span>
          <button
            type="button"
            data-page={page.page + 1}
            disabled={disabled || !page.hasNext}
            aria-label="Next page"
            onClick={onPageChange}
          >
            Next ›
          </button>
          <button
            type="button"
            data-page={page.pageCount}
            disabled={disabled || !page.hasNext}
            aria-label="Last page"
            onClick={onPageChange}
          >
            Last »
          </button>
        </div>
        <label
          className="catalog-pagination-page-size"
          htmlFor={pageSizeInputId}
        >
          {pageSizeLabel}
          <select
            id={pageSizeInputId}
            value={page.pageSize}
            disabled={disabled}
            onChange={onPageSizeChange}
          >
            {CatalogPageSizeOptions.map(size => (
              <option key={size} value={size}>
                {size} per page
              </option>
            ))}
          </select>
        </label>
      </nav>
    )
  }
}
