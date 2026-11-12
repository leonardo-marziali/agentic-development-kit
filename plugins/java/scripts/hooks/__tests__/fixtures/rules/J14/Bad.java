package demo;

class Bad {

    String query = "SELECT id\n" // expect: J14
        + "FROM project\n"
        + "WHERE archived = false";

}
