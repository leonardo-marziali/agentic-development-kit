package demo;

import java.util.List;

class Style {
    private final String name;
    private final int size;
    Style(String name, int size) { this.name = name; this.size = size; }

    String describe() {
        return List.of(name).stream().map(String::trim).filter(value -> !value.isEmpty()).map(value -> value.toUpperCase()).findFirst().orElse("none");
    }

    String message(String firstArgument, String secondArgument) {
        return String.format("%s and %s, followed by a long enough explanation to push this call past the margin", firstArgument, secondArgument);
    }

    boolean matches(String candidateName, int candidateSize, boolean strictComparison, List<String> aliasesToConsider) {
        return strictComparison && candidateName.equals(name) && candidateSize == size && aliasesToConsider.contains(candidateName.trim()) && aliasesToConsider.size() > 1;
    }

    Runnable noop() {
        return () -> {};
    }

    static class Empty {}

    enum Status { DRAFT_AWAITING_REVIEW, UNDER_REVIEW_BY_THE_TEAM, APPROVED_FOR_RELEASE, RELEASED_TO_PRODUCTION, ARCHIVED_AFTER_RETIREMENT }
}
