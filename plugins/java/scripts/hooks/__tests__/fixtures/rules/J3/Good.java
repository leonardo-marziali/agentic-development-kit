package demo;

class Good {

    void f() {
        // A short note.
        // Still short.
        int a = 1; // trailing comments don't count
        int b = 2; // nor do these
        int c = 3; // or these

        /*
         * A long explanation
         * uses a block comment.
         */
        int d = a + b + c;
    }

    /// Markdown Javadoc lines
    /// are documentation,
    /// not line comments.
    void g() {
    }

}
