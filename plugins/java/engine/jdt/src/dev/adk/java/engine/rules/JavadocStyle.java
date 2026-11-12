package dev.adk.java.engine.rules;

import dev.adk.java.engine.Finding;
import dev.adk.java.engine.Rule;
import dev.adk.java.engine.SourceFile;
import java.util.List;
import java.util.regex.Pattern;

/*
 * J2: one documentation syntax per file. Only from Java 23, where `///`
 * starts a Markdown doc comment; before that it is an ordinary comment.
 * The finding goes on the first comment written in the minority style.
 */
final class JavadocStyle implements Rule {

    private static final Pattern MARKDOWN = Pattern.compile("^\\s*///");

    private static final Pattern CLASSIC = Pattern.compile("^\\s*/\\*\\*(?!/)");

    @Override
    public String id() {
        return "J2";
    }

    @Override
    public int minJava() {
        return 23;
    }

    @Override
    public List<Finding> check(SourceFile file) {
        int firstMarkdown = 0;
        int firstClassic = 0;
        int markdown = 0;
        int classic = 0;
        boolean previousMarkdown = false;
        for (int i = 0; i < file.lines().size(); i++) {
            String line = file.lines().get(i);
            boolean isMarkdown = MARKDOWN.matcher(line).find();
            if (isMarkdown && !previousMarkdown) {
                markdown++;
                firstMarkdown = firstMarkdown == 0 ? i + 1 : firstMarkdown;
            }
            if (CLASSIC.matcher(line).find()) {
                classic++;
                firstClassic = firstClassic == 0 ? i + 1 : firstClassic;
            }
            previousMarkdown = isMarkdown;
        }
        if (markdown == 0 || classic == 0) {
            return List.of();
        }
        boolean markdownIsMinority = markdown <= classic;
        int line = markdownIsMinority ? firstMarkdown : firstClassic;
        return List.of(new Finding(line, id(), "This file mixes `///` Markdown and `/** */` HTML doc comments: use "
            + (markdownIsMinority ? "`/** */`" : "`///`") + " throughout, as the rest of the file does."));
    }

}
