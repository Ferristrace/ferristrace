# Lot 22: the validated boards, to the letter

Goal
  The Home page and the table system match the boards the maintainer
  validated in the Design artifact (Hub, HubM, TableMain, TableMainM,
  TableCharts, TableChartsAdd, TableStates), in structure, sizes and copy.
  The one exception: the app never shows invented data. Where a board shows
  something the API does not serve, the page leaves it out and the PR says
  so under "Left out".

Context
  Lot 19 brought design concept 3 into the app (tokens, shell, panels,
  pager). The boards drawn after it go further on two surfaces: the Home
  page and the lists. This lot follows them. No route, query key, hook
  behaviour or Rust code changes.

Home decisions
  H1  The Home page follows Hub (1440) and HubM (390). The decisions of the
      Home work are recorded in its PR.

Table decisions
  T1  One table system, `components/ft/datatable`: a generic `DataTable`
      driven by an array of columns (id, header, cell, sort value, optional
      filter: a checklist of the values present in the loaded rows with
      their counts, or a number compared above or below with presets) and a
      state hook `useDataTable` (search, filters, sort, hidden columns,
      page, selection). Pure parts live in `model.ts` and `sparkGeometry.ts`.
  T2  Everything is client side, over the loaded rows. No server paging is
      invented: when the server caps or orders the rows, the pager says so.
      Where a page already has server filters (Traces facets, query bar,
      placement), they stay; the table's own toolbar says "Search in
      results".
  T3  Toolbar: search, Add filter (pick a column, then its menu), page
      controls, Columns (checklist, Reset, Done), Export CSV. Active filters
      show as chips with "Clear all". Headers sort on click (arrows show on
      hover, accent when sorted) and open the column filter from a funnel.
  T4  Export CSV writes the filtered, sorted loaded rows with the visible
      columns, RFC 4180 quoting, CRLF line ends, through a Blob download.
      With a selection, the selection bar exports the selected rows.
  T5  The visible columns persist per table in localStorage under a key the
      page gives; the table works without storage.
  T6  States: skeleton rows with "Loading…" while nothing is loaded; "No
      {noun} match these filters" with the active chips and "Clear all
      filters"; a selection bar "N selected on this page" with the page's
      actions and "Clear selection"; the header box is indeterminate on a
      partial page.
  T7  Chart cells: line, area or bars over the page window, hover reads one
      value. The Services list draws them from the per-service series
      endpoint, one request per row of the current page only (rows per page
      is 10 or 25), with the same query key as the service page so the
      cache is shared. "Add chart column" picks a metric and a style.
  T8  Services: Status is Down from three times the error threshold,
      Degraded from the threshold (2 %, the status page one), Healthy below,
      No data without traffic. The error-rate change is in points against
      the window before, shown when both windows have traffic. Release is
      the version seen last for the service in the window.
  T9  Phone (<= 760 px): the toolbar wraps as TableMainM, the table scrolls
      inside its panel, the pager centres.

Left out
  - Per-column chart windows (15 min / 1 h / 6 h / 24 h) and colour rules
    in "Add chart column": charts follow the page window and the status
    thresholds.
  - Dragging a chart header to resize its window.
  - "Create alert" from selected rows: no alert flow takes a selection.
  - Namespace as a Services column: the placement picker filters by it on
    the server instead.
  - The total of traces in the window next to the results count: the list
    endpoint does not return it.

Acceptance
  @spec-l22-1  the Home page follows Hub and HubM with real data only
  @spec-l22-2  the table system of T1 to T9 on the Services and Traces
               lists: filtering, sorting, column visibility, CSV quoting,
               selection and paging are unit tested
  @spec-l22-3  navigation of the boards (rail, top bar, phone bottom bar)
               unchanged in its routes
