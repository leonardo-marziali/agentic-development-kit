package dev.adk.java.engine.rules;

import dev.adk.java.engine.Finding;
import dev.adk.java.engine.Rule;
import dev.adk.java.engine.SourceFile;
import java.util.ArrayList;
import java.util.List;
import org.eclipse.jdt.core.dom.ASTVisitor;
import org.eclipse.jdt.core.dom.BooleanLiteral;
import org.eclipse.jdt.core.dom.MemberValuePair;
import org.eclipse.jdt.core.dom.NormalAnnotation;

/* S50: a native query is the last resort, with a comment right above it saying why JPQL wasn't enough. */
final class NativeQueries implements Rule {

    @Override
    public String id() {
        return "S50";
    }

    @Override
    public List<Finding> check(SourceFile file) {
        List<Finding> findings = new ArrayList<>();
        file.ast().accept(new ASTVisitor() {
            @Override
            public boolean visit(NormalAnnotation node) {
                if (Ast.isAnnotation(node, "Query") && isNative(node) && !commented(file, file.line(node))) {
                    findings.add(file.finding(node, id(), "Add a comment above this native query saying why JPQL (or QueryDSL) wasn't enough."));
                }
                return true;
            }
        });
        return findings;
    }

    private static boolean isNative(NormalAnnotation annotation) {
        for (Object item : annotation.values()) {
            MemberValuePair pair = (MemberValuePair) item;
            if (pair.getName().getIdentifier().equals("nativeQuery") && pair.getValue() instanceof BooleanLiteral literal
                && literal.booleanValue()) {
                return true;
            }
        }
        return false;
    }

    private static boolean commented(SourceFile file, int line) {
        if (line < 2) {
            return false;
        }
        String above = file.lines().get(line - 2).trim();
        return above.startsWith("//") || above.endsWith("*/") || above.startsWith("*");
    }

}
