package dev.adk.java.engine.rules;

import dev.adk.java.engine.Finding;
import dev.adk.java.engine.Rule;
import dev.adk.java.engine.SourceFile;
import java.util.List;

/* B6: every `@formatter:off` is closed by an `@formatter:on`, so the block stays short. */
final class FormatterMarkers implements Rule {

    @Override
    public String id() {
        return "B6";
    }

    @Override
    public List<Finding> check(SourceFile file) {
        int openLine = 0;
        for (int i = 0; i < file.lines().size(); i++) {
            String line = file.lines().get(i);
            if (line.contains("@formatter:off") && openLine == 0) {
                openLine = i + 1;
            } else if (line.contains("@formatter:on")) {
                openLine = 0;
            }
        }
        return openLine == 0 ? List.of()
            : List.of(new Finding(openLine, id(), "`@formatter:off` is never turned back on: close it with `@formatter:on` right after the block."));
    }

}
