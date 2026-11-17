package demo;

class GoodVisibility {

    public String name() {
        return hook();
    }

    protected String hook() {
        return packageHelper();
    }

    String packageHelper() {
        return helper();
    }

    private String helper() {
        return "";
    }

}
