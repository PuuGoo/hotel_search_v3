// DDG blacklist and utility functions - extracted for testability

export const DDG_BLACKLISTED_DOMAINS = [
  "booking.com", "agoda.com", "expedia.com", "hotels.com", "tripadvisor.com",
  "airbnb.com", "kayak.com", "trivago.com", "priceline.com", "orbitz.com",
  "travelocity.com", "hotelbeds.com", "traveloka.com", "klook.com", "viator.com",
  "tiket.com", "dorms.com", "hostelworld.com", "hostelbookers.com",
  "google.com", "bing.com", "facebook.com", "instagram.com", "twitter.com",
  "youtube.com", "wikipedia.org", "yelp.com", "foursquare.com",
  "trip.com", "ctrip.com", "hoteles.com", "hrs.com", "hotelopia.com",
  "venere.com", "lastminute.com", "ebookers.com", "otel.com", "goibibo.com",
  "makemytrip.com", "cleartrip.com", "yatra.com", "guestreservations.com",
];

export const DDG_SUSPICIOUS_KEYWORDS = [
  "tophotels", "besthotels", "cheaphotels", "hotelscombined",
  "allhotels", "findhotels", "searchhotels", "comparehotels",
  "hotel-rates", "hotels-rates", "hoteldeals",
];

export function ddgExtractDomain(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function ddgIsSuspicious(domain) {
  const withoutWww = domain.replace(/^www\./, "");
  if ((withoutWww.match(/\./g) || []).length > 1) return true;
  const main = withoutWww.split(".")[0];
  if (DDG_SUSPICIOUS_KEYWORDS.some((k) => main.includes(k))) return true;
  if (/\d{2,}.*hotel/.test(main) || /hotel.*\d{2,}/.test(main)) return true;
  return false;
}

export function ddgIsBlacklisted(url) {
  if (!url) return true;
  const domain = ddgExtractDomain(url);
  const parts = domain.split(".");
  for (const bl of DDG_BLACKLISTED_DOMAINS) {
    const blParts = bl.split(".");
    if (parts.length >= blParts.length) {
      if (parts.slice(-blParts.length).join(".") === bl) return true;
    }
  }
  return ddgIsSuspicious(domain);
}

export function ddgNormalizeName(name) {
  if (!name) return "";
  let n = name.toLowerCase();
  n = n.replace(/\b(the|a|an|at|in|on|by|de|do|da|le|la|el|los|las)\b/g, "");
  n = n.replace(/\b(hotel|resort|spa|inn|suites?|lodge|hostel|motel|apartments?)\b/g, "");
  n = n.replace(/[^a-z0-9]/g, "");
  return n.trim();
}

export function ddgExtractDomainName(url) {
  const domain = ddgExtractDomain(url).replace(/^www\./, "");
  const parts = domain.split(".");
  return parts.length >= 2 ? parts[0] : domain;
}

export function ddgHotelMatchesDomain(hotelName, url) {
  if (!hotelName || !url) return false;
  const domainName = ddgExtractDomainName(url);
  if (!domainName || domainName.length < 4) return false;

  const normalized = ddgNormalizeName(hotelName);
  if (normalized.length >= 4 && (normalized.includes(domainName) || domainName.includes(normalized))) return true;

  let hotelLower = hotelName.toLowerCase();
  hotelLower = hotelLower.replace(/\b(the|a|an|at|in|on|by|de|do|da|le|la|el|los|las)\b/g, " ");
  hotelLower = hotelLower.replace(/\b(hotel|resort|spa|inn|suites?|lodge|hostel|motel|apartments?)\b/g, " ");
  const words = hotelLower.match(/[a-z]{4,}/g) || [];

  for (const word of words) {
    if (domainName.startsWith(word)) return true;
  }

  if (words.length >= 2) {
    const combined2 = words.slice(0, 2).join("");
    if (combined2.length >= 6 && (combined2.includes(domainName) || domainName.startsWith(combined2.slice(0, 6)))) return true;
    if (words.length >= 3) {
      const combined3 = words.slice(0, 3).join("");
      if (combined3.length >= 8 && (combined3.includes(domainName) || domainName.startsWith(combined3.slice(0, 8)))) return true;
    }
  }
  return false;
}

export function ddgExtractActualUrl(ddgUrl) {
  try {
    if (ddgUrl.includes("duckduckgo.com/l/")) {
      const parsed = new URL(ddgUrl);
      const uddg = parsed.searchParams.get("uddg");
      if (uddg) return decodeURIComponent(uddg);
    }
    return ddgUrl;
  } catch {
    return ddgUrl;
  }
}
