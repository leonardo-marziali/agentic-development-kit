package dev.adk.java.engine;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.eclipse.jdt.core.ToolFactory;
import org.eclipse.jdt.core.formatter.CodeFormatter;
import org.eclipse.jface.text.BadLocationException;
import org.eclipse.jface.text.Document;
import org.eclipse.jface.text.IRegion;
import org.eclipse.jface.text.Region;
import org.eclipse.text.edits.TextEdit;

/*
 * Ranged formatting: JDT formats only the regions it is given, so lines the
 * session didn't change keep their existing layout.
 */
final class Formatter {

    private final CodeFormatter codeFormatter;

    Formatter(Map<String, String> options) {
        this.codeFormatter = ToolFactory.createCodeFormatter(options);
    }

    /** The formatted source, the same string when nothing changed, or null when JDT can't format it. */
    String format(String source, Request request) throws BadLocationException {
        String lineSeparator = source.contains("\r\n") ? "\r\n" : "\n";
        IRegion[] regions = request.wholeFile()
            ? new IRegion[] {new Region(0, source.length())}
            : regions(source, request.ranges());
        if (regions.length == 0) {
            return source;
        }
        TextEdit edit = codeFormatter.format(
            CodeFormatter.K_COMPILATION_UNIT | CodeFormatter.F_INCLUDE_COMMENTS, source, regions, 0, lineSeparator);
        if (edit == null) {
            return null;
        }
        Document document = new Document(source);
        edit.apply(document);
        return document.get();
    }

    // 1-based inclusive line ranges as character regions, clamped to the file.
    private static IRegion[] regions(String source, List<int[]> ranges) {
        List<Integer> lineStarts = new ArrayList<>();
        lineStarts.add(0);
        for (int i = 0; i < source.length(); i++) {
            if (source.charAt(i) == '\n') {
                lineStarts.add(i + 1);
            }
        }
        int lineCount = source.endsWith("\n") ? lineStarts.size() - 1 : lineStarts.size();
        List<IRegion> regions = new ArrayList<>();
        for (int[] range : ranges) {
            int first = Math.max(1, range[0]);
            int last = Math.min(lineCount, range[1]);
            if (first > last) {
                continue;
            }
            int start = lineStarts.get(first - 1);
            int end = last < lineStarts.size() ? lineStarts.get(last) : source.length();
            end = trimLineBreak(source, start, end);
            regions.add(new Region(start, end - start));
        }
        return regions.toArray(IRegion[]::new);
    }

    private static int trimLineBreak(String source, int start, int end) {
        int trimmed = end;
        while (trimmed > start && (source.charAt(trimmed - 1) == '\n' || source.charAt(trimmed - 1) == '\r')) {
            trimmed--;
        }
        return trimmed;
    }

}
