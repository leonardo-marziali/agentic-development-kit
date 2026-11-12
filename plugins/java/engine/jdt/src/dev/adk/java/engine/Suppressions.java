package dev.adk.java.engine;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * {@code // java-rules:allow <ID> <reason>} silences that rule on its own line
 * and the next one. The reason is mandatory, per the standard's "write the
 * reason down": an allow without one suppresses nothing and is itself a J0
 * finding.
 */
final class Suppressions {

    private static final Pattern ALLOW = Pattern.compile("//\\s*java-rules:allow\\s+([A-Z]+\\d*[A-Za-z]?)(.*)$");

    private Suppressions() {
    }

    static List<Finding> filter(SourceFile file, List<Finding> findings) {
        Map<Integer, Set<String>> allowed = new HashMap<>();
        List<Finding> result = new ArrayList<>();
        for (int i = 0; i < file.lines().size(); i++) {
            Matcher matcher = ALLOW.matcher(file.lines().get(i));
            if (!matcher.find()) {
                continue;
            }
            int line = i + 1;
            String rule = matcher.group(1);
            if (matcher.group(2).isBlank()) {
                result.add(new Finding(line, "J0",
                    "`java-rules:allow " + rule + "` needs a reason after the rule ID; it suppresses nothing without one."));
                continue;
            }
            allowed.computeIfAbsent(line, l -> new HashSet<>()).add(rule);
            allowed.computeIfAbsent(line + 1, l -> new HashSet<>()).add(rule);
        }
        for (Finding finding : findings) {
            if (!allowed.getOrDefault(finding.line(), Set.of()).contains(finding.rule())) {
                result.add(finding);
            }
        }
        return result;
    }

}
