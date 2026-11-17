package demo;

class BadPrivate {

    private String helper() {
        return "";
    }

    String packageHelper() { // expect: J9
        return helper();
    }

    protected String hook() { // expect: J9
        return packageHelper();
    }

}
