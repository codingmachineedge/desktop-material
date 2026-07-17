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
  /**
   * Invoked when the "Go to page" selector changes. When omitted, the direct
   * page jump is not rendered (the First/Previous/Next/Last buttons remain).
   */
  readonly onPageSelect?: (event: React.ChangeEvent<HTMLSelectElement>) => void
}

/**
 * Reusable First / Previous / Next / Last pagination controls with a page-size
 * selector, shared by every product catalog (GitHub REST + GraphQL operations,
 * the `.gitignore` template catalog, …). It is purely presentational: the page
 * window is computed by `paginateCatalog` and navigation is reported back to the
 * owner, which holds the page state.
 */
export class CatalogPagination extends React.Component<ICatalogPaginationProps> {
  /**
   * Ignore activation of a boundary control. Boundary buttons use
   * `aria-disabled` rather than the `disabled` attribute so activating the last
   * page (which disables the very button that has focus) does not blur it to the
   * document body — keyboard and assistive-technology users keep their place.
   * A stray boundary click would otherwise re-clamp to the same page; guarding
   * here also avoids a needless re-render.
   */
  private onNavClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (event.currentTarget.getAttribute('aria-disabled') === 'true') {
      return
    }
    this.props.onPageChange(event)
  }

  public render() {
    const {
      page,
      navLabel,
      pageSizeLabel,
      pageSizeInputId,
      onPageSizeChange,
      onPageSelect,
    } = this.props
    const disabled = this.props.disabled === true
    const showJump = onPageSelect !== undefined && page.pageCount > 1
    return (
      <nav className="catalog-pagination" aria-label={navLabel}>
        <div className="catalog-pagination-controls">
          <button
            type="button"
            data-page="1"
            disabled={disabled}
            aria-disabled={disabled || !page.hasPrevious}
            aria-label="First page"
            onClick={this.onNavClick}
          >
            « First
          </button>
          <button
            type="button"
            data-page={page.page - 1}
            disabled={disabled}
            aria-disabled={disabled || !page.hasPrevious}
            aria-label="Previous page"
            onClick={this.onNavClick}
          >
            ‹ Prev
          </button>
          <span aria-live="polite">
            Page {page.page} of {page.pageCount}
          </span>
          {showJump ? (
            <label className="catalog-pagination-jump">
              Go to page
              <select
                value={page.page}
                disabled={disabled}
                onChange={onPageSelect}
              >
                {Array.from({ length: page.pageCount }, (_value, index) => (
                  <option key={index + 1} value={index + 1}>
                    {index + 1}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <button
            type="button"
            data-page={page.page + 1}
            disabled={disabled}
            aria-disabled={disabled || !page.hasNext}
            aria-label="Next page"
            onClick={this.onNavClick}
          >
            Next ›
          </button>
          <button
            type="button"
            data-page={page.pageCount}
            disabled={disabled}
            aria-disabled={disabled || !page.hasNext}
            aria-label="Last page"
            onClick={this.onNavClick}
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
