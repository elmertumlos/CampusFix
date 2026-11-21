export const LOCATIONS = new Map([
  ["building-a-washroom", "Building A · 2F washroom"],
  ["science-wing", "Science Wing · 1F"],
  ["library", "Library · Study room 2"],
  ["gym", "Gym · Main entrance"],
  ["cafeteria", "Cafeteria · East exit"],
  ["other", "Other campus location"]
]);

export const CATEGORIES = ["Plumbing", "Electrical", "Facilities", "Waste & recycling", "Other"];
export const CUSTOM_LOCATION_MAX_LENGTH = 120;
export const CUSTOM_CATEGORY_MAX_LENGTH = 80;
export const STATUSES = ["new", "in_progress", "resolved"];
export const STATUS_NOTE_MAX_LENGTH = 300;
export const DISMISSAL_REASONS = ["Spam", "Duplicate", "Invalid"];
export const reportReference = (id) => "CF-" + String(id).padStart(3, "0");
