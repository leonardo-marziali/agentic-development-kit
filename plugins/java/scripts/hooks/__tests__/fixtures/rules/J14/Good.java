package demo;

class Good {

    String query = """
        SELECT id
        FROM project
        WHERE archived = false""";

    String label = "Project " + 42 + "\n";

}
