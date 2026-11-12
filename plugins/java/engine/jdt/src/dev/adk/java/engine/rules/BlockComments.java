package dev.adk.java.engine.rules;

import dev.adk.java.engine.Finding;
import dev.adk.java.engine.Rule;
import dev.adk.java.engine.SourceFile;
import java.util.ArrayList;
import java.util.List;
import org.eclipse.jdt.core.dom.Comment;
import org.eclipse.jdt.core.dom.LineComment;

/*
 * J3: a comment of three or more lines uses /* *\/. Counts only lines that
 * hold nothing but a `//` comment; `///` Markdown doc lines and suppression
 * comments don't count.
 */
final class BlockComments implements Rule {

    private static final int MAX_LINES = 2;

    @Override
    public String id() {
        return "J3";
    }

    @Override
    public List<Finding> check(SourceFile file) {
        List<Finding> findings = new ArrayList<>();
        int runStart = 0;
        int runLength = 0;
        int previousLine = -1;
        for (Object item : file.ast().getCommentList()) {
            Comment comment = (Comment) item;
            int line = file.line(comment);
            if (!(comment instanceof LineComment) || !isOwnLine(file, line)) {
                continue;
            }
            if (line == previousLine + 1) {
                runLength++;
            } else {
                report(findings, runStart, runLength);
                runStart = line;
                runLength = 1;
            }
            previousLine = line;
        }
        report(findings, runStart, runLength);
        return findings;
    }

    private boolean isOwnLine(SourceFile file, int line) {
        String text = file.lines().get(line - 1).trim();
        return text.startsWith("//") && !text.startsWith("///") && !text.contains("java-rules:allow")
            && !text.contains("@formatter:");
    }

    private void report(List<Finding> findings, int start, int length) {
        if (length > MAX_LINES) {
            findings.add(new Finding(start, id(),
                "A comment of " + length + " lines uses a /* */ block, not consecutive // lines."));
        }
    }

}
