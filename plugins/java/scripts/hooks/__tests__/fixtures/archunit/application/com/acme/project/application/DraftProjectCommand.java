package com.acme.project.application;

// What Lombok's @Builder generates: a class whose build() accepts missing values.
public record DraftProjectCommand(String name) {

    public static Builder builder() {
        return new Builder();
    }

    public static final class Builder {

        private String name;

        public Builder name(String name) {
            this.name = name;
            return this;
        }

        public DraftProjectCommand build() {
            return new DraftProjectCommand(name);
        }

    }

}
