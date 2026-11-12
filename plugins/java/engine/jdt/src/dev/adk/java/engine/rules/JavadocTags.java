package dev.adk.java.engine.rules;

import dev.adk.java.engine.Finding;
import dev.adk.java.engine.Rule;
import dev.adk.java.engine.SourceFile;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/* J1: no @author or @version in documentation comments; Git records both. */
final class JavadocTags implements Rule {

    private static final Pattern TAG = Pattern.compile("^\\s*(?:\\*|///)\\s*@(author|version)\\b");

    @Override
    public String id() {
        return "J1";
    }

    @Override
    public List<Finding> check(SourceFile file) {
        List<Finding> findings = new ArrayList<>();
        for (int i = 0; i < file.lines().size(); i++) {
            Matcher matcher = TAG.matcher(file.lines().get(i));
            if (matcher.find()) {
                findings.add(new Finding(i + 1, id(), "Remove `@" + matcher.group(1) + "`: Git already records it."));
            }
        }
        return findings;
    }

}
