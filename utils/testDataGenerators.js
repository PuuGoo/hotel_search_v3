// Test data generators — generate realistic test data for all entities

const FIRST_NAMES = ["Alice", "Bob", "Charlie", "Diana", "Eve", "Frank", "Grace", "Henry", "Ivy", "Jack"];
const LAST_NAMES = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez"];
const CITIES = ["New York", "Los Angeles", "Chicago", "Houston", "Phoenix", "Philadelphia", "San Antonio", "San Diego", "Dallas", "San Jose"];
const HOTEL_NAMES = ["Grand Hotel", "Ocean View", "Mountain Lodge", "City Center Inn", "Beach Resort", "Royal Palace", "Sunset Villa", "Garden Suite", "Sky Tower", "Lake House"];
const ENGINES = ["google", "tavily", "ddg", "searxng", "crawlbase"];

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomEmail(first, last) {
  return `${first.toLowerCase()}.${last.toLowerCase()}@example.com`;
}

/**
 * Generate a user object.
 */
export function generateUser(overrides = {}) {
  const first = randomItem(FIRST_NAMES);
  const last = randomItem(LAST_NAMES);
  return {
    id: `user-${Date.now().toString(36)}-${randomInt(1000, 9999)}`,
    username: `${first.toLowerCase()}${randomInt(1, 999)}`,
    email: randomEmail(first, last),
    firstName: first,
    lastName: last,
    role: randomItem(["user", "admin"]),
    createdAt: Date.now() - randomInt(0, 30 * 24 * 60 * 60 * 1000),
    ...overrides,
  };
}

/**
 * Generate multiple users.
 */
export function generateUsers(count = 10, overrides = {}) {
  return Array.from({ length: count }, () => generateUser(overrides));
}

/**
 * Generate a search query.
 */
export function generateSearchQuery(overrides = {}) {
  const city = randomItem(CITIES);
  return {
    id: `search-${Date.now().toString(36)}-${randomInt(1000, 9999)}`,
    query: `hotels in ${city}`,
    engine: randomItem(ENGINES),
    city,
    checkIn: new Date(Date.now() + randomInt(1, 30) * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
    checkOut: new Date(Date.now() + randomInt(31, 60) * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
    guests: randomInt(1, 4),
    userId: `user-${randomInt(1, 100)}`,
    timestamp: Date.now() - randomInt(0, 7 * 24 * 60 * 60 * 1000),
    ...overrides,
  };
}

/**
 * Generate multiple search queries.
 */
export function generateSearchQueries(count = 10, overrides = {}) {
  return Array.from({ length: count }, () => generateSearchQuery(overrides));
}

/**
 * Generate a hotel result.
 */
export function generateHotelResult(overrides = {}) {
  const city = randomItem(CITIES);
  return {
    id: `hotel-${Date.now().toString(36)}-${randomInt(1000, 9999)}`,
    name: `${randomItem(HOTEL_NAMES)} ${city}`,
    city,
    address: `${randomInt(1, 999)} ${randomItem(["Main", "Oak", "Elm", "Pine", "Maple"])} St`,
    rating: Math.round((Math.random() * 2 + 3) * 10) / 10, // 3.0 - 5.0
    price: randomInt(50, 500),
    currency: "USD",
    amenities: ["wifi", "pool", "gym", "breakfast", "parking"].filter(() => Math.random() > 0.4),
    imageUrl: `https://example.com/hotel-${randomInt(1, 100)}.jpg`,
    bookingUrl: `https://example.com/book/${randomInt(1000, 9999)}`,
    source: randomItem(ENGINES),
    ...overrides,
  };
}

/**
 * Generate multiple hotel results.
 */
export function generateHotelResults(count = 10, overrides = {}) {
  return Array.from({ length: count }, () => generateHotelResult(overrides));
}

/**
 * Generate a bookmark.
 */
export function generateBookmark(overrides = {}) {
  const hotel = generateHotelResult();
  return {
    id: `bookmark-${Date.now().toString(36)}-${randomInt(1000, 9999)}`,
    hotelId: hotel.id,
    hotelName: hotel.name,
    city: hotel.city,
    price: hotel.price,
    rating: hotel.rating,
    notes: "",
    tags: [],
    userId: `user-${randomInt(1, 100)}`,
    createdAt: Date.now() - randomInt(0, 30 * 24 * 60 * 60 * 1000),
    ...overrides,
  };
}

/**
 * Generate multiple bookmarks.
 */
export function generateBookmarks(count = 10, overrides = {}) {
  return Array.from({ length: count }, () => generateBookmark(overrides));
}

/**
 * Generate a price alert.
 */
export function generatePriceAlert(overrides = {}) {
  const hotel = generateHotelResult();
  return {
    id: `alert-${Date.now().toString(36)}-${randomInt(1000, 9999)}`,
    hotelId: hotel.id,
    hotelName: hotel.name,
    city: hotel.city,
    currentPrice: hotel.price,
    targetPrice: Math.round(hotel.price * (Math.random() * 0.3 + 0.7)), // 70-100% of current
    direction: randomItem(["below", "above"]),
    enabled: true,
    userId: `user-${randomInt(1, 100)}`,
    createdAt: Date.now() - randomInt(0, 30 * 24 * 60 * 60 * 1000),
    ...overrides,
  };
}

/**
 * Generate multiple price alerts.
 */
export function generatePriceAlerts(count = 10, overrides = {}) {
  return Array.from({ length: count }, () => generatePriceAlert(overrides));
}

/**
 * Generate a webhook.
 */
export function generateWebhook(overrides = {}) {
  return {
    id: `webhook-${Date.now().toString(36)}-${randomInt(1000, 9999)}`,
    url: `https://example.com/webhook/${randomInt(1000, 9999)}`,
    event: randomItem(["price.change", "search.complete", "alert.triggered"]),
    enabled: true,
    secret: `whsec_${randomInt(100000, 999999)}`,
    userId: `user-${randomInt(1, 100)}`,
    createdAt: Date.now() - randomInt(0, 30 * 24 * 60 * 60 * 1000),
    ...overrides,
  };
}

/**
 * Generate multiple webhooks.
 */
export function generateWebhooks(count = 10, overrides = {}) {
  return Array.from({ length: count }, () => generateWebhook(overrides));
}

/**
 * Generate an audit log entry.
 */
export function generateAuditEntry(overrides = {}) {
  const user = generateUser();
  return {
    id: `audit-${Date.now().toString(36)}-${randomInt(1000, 9999)}`,
    action: randomItem(["user.login", "user.logout", "search.create", "bookmark.add", "alert.create"]),
    userId: user.id,
    username: user.username,
    ip: `${randomInt(1, 255)}.${randomInt(0, 255)}.${randomInt(0, 255)}.${randomInt(1, 255)}`,
    userAgent: "Mozilla/5.0 Test Browser",
    details: {},
    timestamp: Date.now() - randomInt(0, 7 * 24 * 60 * 60 * 1000),
    ...overrides,
  };
}

/**
 * Generate multiple audit entries.
 */
export function generateAuditEntries(count = 10, overrides = {}) {
  return Array.from({ length: count }, () => generateAuditEntry(overrides));
}

/**
 * Generate a notification.
 */
export function generateNotification(overrides = {}) {
  return {
    id: `notif-${Date.now().toString(36)}-${randomInt(1000, 9999)}`,
    type: randomItem(["info", "warning", "success", "error"]),
    title: randomItem(["Price Alert", "Search Complete", "New Feature", "System Update"]),
    message: `Notification message ${randomInt(1, 100)}`,
    read: false,
    userId: `user-${randomInt(1, 100)}`,
    createdAt: Date.now() - randomInt(0, 7 * 24 * 60 * 60 * 1000),
    ...overrides,
  };
}

/**
 * Generate multiple notifications.
 */
export function generateNotifications(count = 10, overrides = {}) {
  return Array.from({ length: count }, () => generateNotification(overrides));
}

/**
 * Get all generator functions.
 */
export function getGenerators() {
  return {
    user: generateUser,
    users: generateUsers,
    searchQuery: generateSearchQuery,
    searchQueries: generateSearchQueries,
    hotelResult: generateHotelResult,
    hotelResults: generateHotelResults,
    bookmark: generateBookmark,
    bookmarks: generateBookmarks,
    priceAlert: generatePriceAlert,
    priceAlerts: generatePriceAlerts,
    webhook: generateWebhook,
    webhooks: generateWebhooks,
    auditEntry: generateAuditEntry,
    auditEntries: generateAuditEntries,
    notification: generateNotification,
    notifications: generateNotifications,
  };
}
