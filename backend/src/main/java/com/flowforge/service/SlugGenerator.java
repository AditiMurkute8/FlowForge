package com.flowforge.service;

import java.text.Normalizer;
import java.util.Locale;

/**
 * Deterministic slug generator and normalizer for Project and Workflow resources.
 */
public final class SlugGenerator {

    public static final int MAX_SLUG_LENGTH = 100;

    private SlugGenerator() {
        // Utility class
    }

    /**
     * Generates a URL-safe, deterministic slug from a human-readable display name.
     * Accents and diacritics are removed, non-alphanumeric characters are converted to hyphens,
     * and leading/trailing hyphens are stripped.
     *
     * @param name input name
     * @return a valid URL slug, or "untitled" if the input produces an empty slug
     */
    public static String generateSlug(String name) {
        if (name == null || name.isBlank()) {
            return "untitled";
        }
        String normalized = Normalizer.normalize(name, Normalizer.Form.NFD)
                .replaceAll("\\p{M}", "");
        String slug = normalized.toLowerCase(Locale.ROOT)
                .replaceAll("[^a-z0-9]+", "-")
                .replaceAll("^-+|-+$", "");
        if (slug.isBlank()) {
            return "untitled";
        }
        return slug.length() > MAX_SLUG_LENGTH
                ? slug.substring(0, MAX_SLUG_LENGTH).replaceAll("-+$", "")
                : slug;
    }

    /**
     * Normalizes and validates an explicitly supplied custom slug.
     *
     * @param slug custom slug
     * @return normalized slug
     * @throws IllegalArgumentException if the slug is null, blank, contains no alphanumeric characters,
     *                                  or exceeds maximum allowed length
     */
    public static String normalizeSlug(String slug) {
        if (slug == null || slug.isBlank()) {
            throw new IllegalArgumentException("Slug must not be blank");
        }
        String normalized = Normalizer.normalize(slug, Normalizer.Form.NFD)
                .replaceAll("\\p{M}", "");
        String cleaned = normalized.toLowerCase(Locale.ROOT)
                .replaceAll("[^a-z0-9]+", "-")
                .replaceAll("^-+|-+$", "");
        if (cleaned.isBlank()) {
            throw new IllegalArgumentException("Slug must contain at least one alphanumeric character");
        }
        if (cleaned.length() > MAX_SLUG_LENGTH) {
            throw new IllegalArgumentException("Slug must not exceed " + MAX_SLUG_LENGTH + " characters");
        }
        return cleaned;
    }
}
