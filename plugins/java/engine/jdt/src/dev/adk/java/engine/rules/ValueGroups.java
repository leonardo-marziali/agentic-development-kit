package dev.adk.java.engine.rules;

import dev.adk.java.engine.Finding;
import dev.adk.java.engine.Rule;
import dev.adk.java.engine.SourceFile;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.eclipse.jdt.core.dom.ASTNode;
import org.eclipse.jdt.core.dom.ASTVisitor;
import org.eclipse.jdt.core.dom.AbstractTypeDeclaration;
import org.eclipse.jdt.core.dom.FieldDeclaration;
import org.eclipse.jdt.core.dom.Modifier;
import org.eclipse.jdt.core.dom.PackageDeclaration;
import org.eclipse.jdt.core.dom.RecordDeclaration;
import org.eclipse.jdt.core.dom.SingleVariableDeclaration;
import org.eclipse.jdt.core.dom.TypeDeclaration;
import org.eclipse.jdt.core.dom.VariableDeclarationFragment;

/*
 * D12: values that belong together in the domain are one type. A heuristic:
 * three or more fields sharing a first camelCase word (`addressStreet`,
 * `addressCity`, `addressZip`) in a JPA `@Entity`, a MongoDB `@Document`, a
 * `*Dto` or a class in a `domain` package. Raw SQL rows (Spring Data JDBC
 * `@Table`, jOOQ) aren't checked: there, grouping costs joins. Boolean
 * prefixes (`is`, `has`, …) name a property, not a group.
 */
final class ValueGroups implements Rule {

    private static final int MIN_GROUP = 3;

    private static final Pattern PREFIX = Pattern.compile("^([a-z]+)[A-Z0-9]");

    private static final Set<String> NOT_GROUPS = Set.of("is", "has", "can", "should", "was", "will");

    @Override
    public String id() {
        return "D12";
    }

    @Override
    public List<Finding> check(SourceFile file) {
        List<Finding> findings = new ArrayList<>();
        boolean domainPackage = isDomainPackage(file.ast().getPackage());
        file.ast().accept(new ASTVisitor() {
            @Override
            public boolean visit(TypeDeclaration node) {
                if (!node.isInterface() && inScope(node, domainPackage)) {
                    List<ASTNode> fields = new ArrayList<>();
                    for (FieldDeclaration field : node.getFields()) {
                        if (!Modifier.isStatic(field.getModifiers())) {
                            for (Object fragment : field.fragments()) {
                                fields.add(((VariableDeclarationFragment) fragment).getName());
                            }
                        }
                    }
                    report(fields);
                }
                return true;
            }

            @Override
            public boolean visit(RecordDeclaration node) {
                if (inScope(node, domainPackage)) {
                    List<ASTNode> fields = new ArrayList<>();
                    for (Object component : node.recordComponents()) {
                        fields.add(((SingleVariableDeclaration) component).getName());
                    }
                    report(fields);
                }
                return true;
            }

            private void report(List<ASTNode> names) {
                Map<String, List<ASTNode>> groups = new LinkedHashMap<>();
                for (ASTNode name : names) {
                    Matcher matcher = PREFIX.matcher(name.toString());
                    if (matcher.find() && !NOT_GROUPS.contains(matcher.group(1))) {
                        groups.computeIfAbsent(matcher.group(1), key -> new ArrayList<>()).add(name);
                    }
                }
                groups.forEach((prefix, members) -> {
                    if (members.size() >= MIN_GROUP) {
                        String type = Character.toUpperCase(prefix.charAt(0)) + prefix.substring(1);
                        findings.add(file.finding(members.get(0), id(), "`"
                            + String.join("`, `", members.stream().map(ASTNode::toString).toList())
                            + "` belong together: group them in one `" + type + "` type (an `@Embeddable` in an entity,"
                            + " a nested DTO in a DTO, a value object in the domain)."));
                    }
                });
            }
        });
        return findings;
    }

    private static boolean inScope(AbstractTypeDeclaration type, boolean domainPackage) {
        return domainPackage || type.getName().getIdentifier().endsWith("Dto") || Ast.hasAnnotation(type, "Entity")
            || Ast.hasAnnotation(type, "Document");
    }

    private static boolean isDomainPackage(PackageDeclaration declaration) {
        return declaration != null && ("." + declaration.getName().getFullyQualifiedName() + ".").contains(".domain.");
    }

}
