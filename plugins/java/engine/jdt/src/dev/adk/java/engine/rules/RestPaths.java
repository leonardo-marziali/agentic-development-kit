package dev.adk.java.engine.rules;

import dev.adk.java.engine.Finding;
import dev.adk.java.engine.Rule;
import dev.adk.java.engine.SourceFile;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;
import org.eclipse.jdt.core.dom.ASTNode;
import org.eclipse.jdt.core.dom.ASTVisitor;
import org.eclipse.jdt.core.dom.Annotation;
import org.eclipse.jdt.core.dom.ArrayInitializer;
import org.eclipse.jdt.core.dom.BodyDeclaration;
import org.eclipse.jdt.core.dom.Expression;
import org.eclipse.jdt.core.dom.MemberValuePair;
import org.eclipse.jdt.core.dom.NormalAnnotation;
import org.eclipse.jdt.core.dom.SingleMemberAnnotation;
import org.eclipse.jdt.core.dom.StringLiteral;

/*
 * S28: paths name resources, never actions (no `/getProjects`).
 * S30: path variables are named after their resource (`{projectId}`, not `{id}`).
 *
 * Both skip internal endpoints: per S37 an event callback or HTTP RPC is marked
 * `@Hidden` (on the method or its controller), isn't part of the public
 * contract, and may use a verb.
 */
final class RestPaths {

    private static final List<String> MAPPINGS = List.of("RequestMapping", "GetMapping", "PostMapping", "PutMapping",
        "PatchMapping", "DeleteMapping");

    private static final Pattern VERB = Pattern.compile(
        "^(get|create|update|delete|add|remove|fetch|list|find|save|archive|do)([A-Z_-].*)?$");

    private RestPaths() {
    }

    static List<String> paths(Annotation annotation) {
        List<String> paths = new ArrayList<>();
        if (annotation instanceof SingleMemberAnnotation single) {
            collect(single.getValue(), paths);
        } else if (annotation instanceof NormalAnnotation normal) {
            for (Object item : normal.values()) {
                MemberValuePair pair = (MemberValuePair) item;
                String member = pair.getName().getIdentifier();
                if (member.equals("value") || member.equals("path")) {
                    collect(pair.getValue(), paths);
                }
            }
        }
        return paths;
    }

    private static void collect(Expression expression, List<String> paths) {
        if (expression instanceof StringLiteral literal) {
            paths.add(literal.getLiteralValue());
        } else if (expression instanceof ArrayInitializer array) {
            for (Object item : array.expressions()) {
                collect((Expression) item, paths);
            }
        }
    }

    // The annotated declaration, or any type enclosing it, carries @Hidden.
    private static boolean isHidden(Annotation annotation) {
        for (ASTNode node = annotation.getParent(); node != null; node = node.getParent()) {
            if (node instanceof BodyDeclaration declaration && Ast.hasAnnotation(declaration, "Hidden")) {
                return true;
            }
        }
        return false;
    }

    private abstract static class PathRule implements Rule {

        @Override
        public List<Finding> check(SourceFile file) {
            List<Finding> findings = new ArrayList<>();
            file.ast().accept(new ASTVisitor() {
                @Override
                public boolean visit(SingleMemberAnnotation node) {
                    inspect(node);
                    return true;
                }

                @Override
                public boolean visit(NormalAnnotation node) {
                    inspect(node);
                    return true;
                }

                private void inspect(Annotation annotation) {
                    if (MAPPINGS.stream().noneMatch(m -> Ast.isAnnotation(annotation, m)) || isHidden(annotation)) {
                        return;
                    }
                    for (String path : paths(annotation)) {
                        for (String segment : path.split("/")) {
                            String message = violation(segment, path);
                            if (message != null) {
                                findings.add(file.finding(annotation, id(), message));
                                return;
                            }
                        }
                    }
                }
            });
            return findings;
        }

        abstract String violation(String segment, String path);

    }

    static final class Nouns extends PathRule {

        @Override
        public String id() {
            return "S28";
        }

        @Override
        String violation(String segment, String path) {
            return !segment.startsWith("{") && VERB.matcher(segment).matches()
                ? "`" + path + "` puts a verb in the path: name the resource and let the HTTP method be the verb." : null;
        }

    }

    static final class VariableNames extends PathRule {

        @Override
        public String id() {
            return "S30";
        }

        @Override
        String violation(String segment, String path) {
            return segment.equals("{id}") ? "Name the path variable after its resource (`{projectId}`), not `{id}`, in `" + path + "`."
                : null;
        }

    }

}
