package dev.adk.java.engine;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/*
 * One line of the request file: a file and which of its lines to format.
 * "*" formats the whole file, "-" formats nothing (rules only), and
 * "3-4,9-9" formats those 1-based, inclusive line ranges.
 */
record Request(Path path, List<int[]> ranges, boolean wholeFile) {

    boolean formats() {
        return wholeFile || !ranges.isEmpty();
    }

    static List<Request> read(Path requestFile) throws IOException {
        List<Request> requests = new ArrayList<>();
        for (String line : Files.readAllLines(requestFile, StandardCharsets.UTF_8)) {
            if (line.isBlank()) {
                continue;
            }
            int tab = line.lastIndexOf('\t');
            String file = tab < 0 ? line : line.substring(0, tab);
            String field = tab < 0 ? "-" : line.substring(tab + 1).trim();
            requests.add(parse(Path.of(file), field));
        }
        return requests;
    }

    private static Request parse(Path path, String field) {
        if (field.equals("*")) {
            return new Request(path, List.of(), true);
        }
        List<int[]> ranges = new ArrayList<>();
        if (!field.equals("-")) {
            for (String range : field.split(",")) {
                String[] bounds = range.split("-");
                int start = Integer.parseInt(bounds[0].trim());
                int end = bounds.length > 1 ? Integer.parseInt(bounds[1].trim()) : start;
                ranges.add(new int[] {start, end});
            }
        }
        return new Request(path, ranges, false);
    }

}
