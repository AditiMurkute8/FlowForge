package com.flowforge.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class SlugGeneratorTest {

    @Test
    @DisplayName("generateSlug converts plain names to lowercase hyphenated slugs")
    void testGenerateSlugBasic() {
        assertThat(SlugGenerator.generateSlug("My First Pipeline")).isEqualTo("my-first-pipeline");
        assertThat(SlugGenerator.generateSlug("Workflow_Test 123")).isEqualTo("workflow-test-123");
        assertThat(SlugGenerator.generateSlug("Simple")).isEqualTo("simple");
    }

    @Test
    @DisplayName("generateSlug removes unicode accents and diacritics")
    void testGenerateSlugAccents() {
        assertThat(SlugGenerator.generateSlug("Café & Crème brûlée")).isEqualTo("cafe-creme-brulee");
        assertThat(SlugGenerator.generateSlug("Über Flöw")).isEqualTo("uber-flow");
    }

    @Test
    @DisplayName("generateSlug handles special characters and repeated hyphens")
    void testGenerateSlugSpecialCharacters() {
        assertThat(SlugGenerator.generateSlug("---Hello---World---")).isEqualTo("hello-world");
        assertThat(SlugGenerator.generateSlug("Special @#$% Characters *&^% Here")).isEqualTo("special-characters-here");
    }

    @Test
    @DisplayName("generateSlug returns 'untitled' for null, blank, or non-alphanumeric inputs")
    void testGenerateSlugNullOrBlank() {
        assertThat(SlugGenerator.generateSlug(null)).isEqualTo("untitled");
        assertThat(SlugGenerator.generateSlug("")).isEqualTo("untitled");
        assertThat(SlugGenerator.generateSlug("   ")).isEqualTo("untitled");
        assertThat(SlugGenerator.generateSlug("!@#$%^&*()")).isEqualTo("untitled");
    }

    @Test
    @DisplayName("generateSlug truncates to maximum 100 characters without trailing hyphen")
    void testGenerateSlugLengthLimit() {
        String longName = "a".repeat(150);
        String slug = SlugGenerator.generateSlug(longName);
        assertThat(slug).hasSize(100);
        assertThat(slug).doesNotEndWith("-");
    }

    @Test
    @DisplayName("normalizeSlug cleans and validates custom slugs")
    void testNormalizeSlugValid() {
        assertThat(SlugGenerator.normalizeSlug("custom-slug-1")).isEqualTo("custom-slug-1");
        assertThat(SlugGenerator.normalizeSlug("Custom_Slug--2")).isEqualTo("custom-slug-2");
        assertThat(SlugGenerator.normalizeSlug("  padded-slug  ")).isEqualTo("padded-slug");
    }

    @Test
    @DisplayName("normalizeSlug rejects null, blank, or invalid custom slugs")
    void testNormalizeSlugInvalid() {
        assertThatThrownBy(() -> SlugGenerator.normalizeSlug(null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Slug must not be blank");

        assertThatThrownBy(() -> SlugGenerator.normalizeSlug("   "))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Slug must not be blank");

        assertThatThrownBy(() -> SlugGenerator.normalizeSlug("---"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Slug must contain at least one alphanumeric character");

        String overLimit = "a".repeat(101);
        assertThatThrownBy(() -> SlugGenerator.normalizeSlug(overLimit))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Slug must not exceed 100 characters");
    }
}
