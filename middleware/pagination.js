// Pagination helper — adds HATEOAS-style links to paginated responses

/**
 * Generate pagination metadata and links.
 *
 * @param {object} options
 * @param {number} options.page - Current page (1-based)
 * @param {number} options.limit - Items per page
 * @param {number} options.total - Total item count
 * @param {string} options.baseUrl - Base URL for links (without query string)
 * @param {object} options.query - Additional query params to preserve
 * @returns {object} Pagination metadata with links
 */
export function paginate({ page, limit, total, baseUrl, query = {} }) {
  const totalPages = Math.ceil(total / limit) || 1;
  const currentPage = Math.max(1, Math.min(page, totalPages));

  function buildUrl(p) {
    const params = new URLSearchParams({ ...query, page: String(p), limit: String(limit) });
    return `${baseUrl}?${params.toString()}`;
  }

  const links = {
    self: buildUrl(currentPage),
    first: buildUrl(1),
    last: buildUrl(totalPages),
  };

  if (currentPage > 1) {
    links.prev = buildUrl(currentPage - 1);
  }
  if (currentPage < totalPages) {
    links.next = buildUrl(currentPage + 1);
  }

  return {
    page: currentPage,
    limit,
    total,
    totalPages,
    hasMore: currentPage < totalPages,
    links,
  };
}

/**
 * Express middleware that adds pagination helpers to res.
 * Usage: res.paginate({ data, total, page, limit })
 */
export function paginationMiddleware(req, res, next) {
  res.paginate = ({ data, total, page = 1, limit = 20 }) => {
    const baseUrl = `${req.protocol}://${req.get("host")}${req.path}`;
    const { query } = req;

    const pagination = paginate({ page, limit, total, baseUrl, query });

    // Set Link header (RFC 8288)
    const linkParts = [];
    for (const [rel, url] of Object.entries(pagination.links)) {
      linkParts.push(`<${url}>; rel="${rel}"`);
    }
    res.setHeader("Link", linkParts.join(", "));

    // Set pagination headers
    res.setHeader("X-Total-Count", total);
    res.setHeader("X-Page-Count", pagination.totalPages);

    return res.json({
      data,
      pagination,
    });
  };

  next();
}
