package dev.adk.java.engine;

/** One rule violation: a 1-based line, the standard's rule ID and a message for Claude. */
record Finding(int line, String rule, String message) {
}
