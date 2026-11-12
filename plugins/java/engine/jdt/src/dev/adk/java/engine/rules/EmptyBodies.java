package dev.adk.java.engine.rules;

import dev.adk.java.engine.Finding;
import dev.adk.java.engine.Rule;
import dev.adk.java.engine.SourceFile;
import java.util.ArrayList;
import java.util.List;
import org.eclipse.jdt.core.dom.ASTVisitor;
import org.eclipse.jdt.core.dom.Block;
import org.eclipse.jdt.core.dom.Comment;
import org.eclipse.jdt.core.dom.MethodDeclaration;

/*
 * J25: an empty method or constructor body holds a comment saying why it is
 * empty. A Javadoc above the method doesn't count: the reader looking at the
 * empty braces is the one who needs the explanation.
 */
final class EmptyBodies implements Rule {

    @Override
    public String id() {
        return "J25";
    }

    @Override
    public List<Finding> check(SourceFile file) {
        List<Finding> findings = new ArrayList<>();
        List<?> comments = file.ast().getCommentList();
        file.ast().accept(new ASTVisitor() {
            @Override
            public boolean visit(MethodDeclaration node) {
                Block body = node.getBody();
                if (body != null && body.statements().isEmpty() && !hasCommentInside(body, comments)) {
                    String kind = node.isConstructor() ? "constructor" : "method";
                    findings.add(new Finding(file.line(node.getName()), id(), "This " + kind
                        + " is empty: add a comment inside its body saying why it does nothing."));
                }
                return true;
            }
        });
        return findings;
    }

    private static boolean hasCommentInside(Block body, List<?> comments) {
        int start = body.getStartPosition();
        int end = start + body.getLength();
        for (Object item : comments) {
            Comment comment = (Comment) item;
            if (comment.getStartPosition() > start && comment.getStartPosition() + comment.getLength() < end) {
                return true;
            }
        }
        return false;
    }

}
