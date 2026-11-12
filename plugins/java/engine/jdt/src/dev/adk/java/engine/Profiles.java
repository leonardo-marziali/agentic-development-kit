package dev.adk.java.engine;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;
import java.util.Properties;
import javax.xml.parsers.DocumentBuilderFactory;
import org.eclipse.jdt.core.JavaCore;
import org.eclipse.jdt.core.formatter.DefaultCodeFormatterConstants;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

/*
 * Formatter and compiler options: Eclipse's defaults, overlaid with the
 * project's profile (an Eclipse XML export or a .prefs file), then the
 * module's Java level so the parser accepts exactly the syntax it targets.
 */
final class Profiles {

    private Profiles() {
    }

    static Map<String, String> load(Path profile, int javaLevel) throws Exception {
        Map<String, String> options = new HashMap<>(DefaultCodeFormatterConstants.getEclipseDefaultSettings());
        if (profile != null) {
            options.putAll(profile.toString().endsWith(".prefs") ? readPrefs(profile) : readXml(profile));
        }
        String level = javaLevel(javaLevel);
        options.put(JavaCore.COMPILER_SOURCE, level);
        options.put(JavaCore.COMPILER_COMPLIANCE, level);
        options.put(JavaCore.COMPILER_CODEGEN_TARGET_PLATFORM, level);
        return options;
    }

    // JDT names Java 8 "1.8"; levels newer than this JDT knows are clamped.
    static String javaLevel(int level) {
        if (level <= 8) {
            return "1." + Math.max(level, 1);
        }
        int latest = Integer.parseInt(JavaCore.latestSupportedJavaVersion());
        return String.valueOf(Math.min(level, latest));
    }

    private static Map<String, String> readPrefs(Path file) throws IOException {
        Properties properties = new Properties();
        try (InputStream in = Files.newInputStream(file)) {
            properties.load(in);
        }
        Map<String, String> settings = new HashMap<>();
        properties.stringPropertyNames().forEach(name -> settings.put(name, properties.getProperty(name)));
        return settings;
    }

    // The first CodeFormatterProfile in an Eclipse "Export profile" file.
    private static Map<String, String> readXml(Path file) throws Exception {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        factory.setExpandEntityReferences(false);
        NodeList profiles = factory.newDocumentBuilder().parse(file.toFile()).getElementsByTagName("profile");
        Map<String, String> settings = new HashMap<>();
        for (int i = 0; i < profiles.getLength(); i++) {
            Element profile = (Element) profiles.item(i);
            String kind = profile.getAttribute("kind");
            if (!kind.isEmpty() && !kind.equals("CodeFormatterProfile")) {
                continue;
            }
            NodeList entries = profile.getElementsByTagName("setting");
            for (int j = 0; j < entries.getLength(); j++) {
                Element setting = (Element) entries.item(j);
                settings.put(setting.getAttribute("id"), setting.getAttribute("value"));
            }
            break;
        }
        return settings;
    }

}
